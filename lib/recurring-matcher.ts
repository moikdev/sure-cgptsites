import { expectedOccurrenceAmount, occurrencesBetween, occurrenceScheduleState, recurrenceHalfCycle, addDays } from "./recurring.ts";
import { precision, sumMinorUnits, type FinanceState, type RecurringEntry, type RecurringOccurrence, type RecurringAllocation, type Transaction } from "./finance.ts";
import type { RecurringMatcherSettings } from "./recurring-matcher-types.ts";
import { recurringMatcherSettingsSchema } from "./recurring-matcher-schema.ts";
import { paymentCapacity, resolvePaymentConversion } from "./recurring-fx.ts";

export const matcherDefaults = () => recurringMatcherSettingsSchema.parse({});
export const normalizeMatcherName = (name: string) => name.toLowerCase().replace(/\s+/gu, " ").trim();
export function matcherPercentUnits(value: string) { const [whole, part = ""] = value.split("."); return BigInt(whole) * 100n + BigInt(part.padEnd(2, "0")); }
const rounded = (n: bigint, d: bigint) => Number((2n * n + d) / (2n * d));
const distance = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const sourceKey = (transactionId: string, splitLineId: string | null) => JSON.stringify([transactionId, splitLineId]);
export function matcherKnownNames(entry: RecurringEntry) { return new Set([entry.name, entry.matching?.detectedName ?? "", ...(entry.matching?.aliases ?? [])].map(normalizeMatcherName).filter(Boolean)); }
export function preserveMatcherName(entry: RecurringEntry, nextName: string): RecurringMatcherSettings | null {
  if (!entry.matching) return null;
  return { ...entry.matching, detectedName: entry.matching.detectedName ?? (entry.name !== nextName ? entry.name : null) };
}
export function matcherAmountScore(expected: number, actual: number, currency: RecurringEntry["currency"], config: RecurringMatcherSettings): number | null {
  const delta = BigInt(Math.abs(actual - expected));
  if (delta * 100n < 10n ** BigInt(precision(currency))) return 3000;
  const tolerance = matcherPercentUnits(config.amountTolerancePct) > matcherPercentUnits(config.learnedTolerancePct) ? matcherPercentUnits(config.amountTolerancePct) : matcherPercentUnits(config.learnedTolerancePct);
  const band = BigInt(expected) * tolerance;
  if (!band || delta * 10000n > band) return null;
  return rounded(2500n * band - delta * 10000n * 1000n, band);
}
export function matcherWindow(entry: RecurringEntry, occurrence: RecurringOccurrence, state: FinanceState, asOf: string) {
  const settings = entry.matching ?? matcherDefaults(), dueOn = occurrence.snoozedUntil && occurrence.snoozedUntil > occurrence.dueOn ? occurrence.snoozedUntil : occurrence.dueOn;
  const half = recurrenceHalfCycle(entry), start = addDays(dueOn, -Math.min(half, settings.daysEarly));
  let end = addDays(dueOn, Math.min(half, settings.daysLate));
  if (occurrenceScheduleState(entry, occurrence, asOf) === "overdue" && asOf > end) end = asOf;
  return { start, end, dueOn };
}
export interface MatchSource { transaction: Transaction; splitLineId: string | null; name: string; merchantId: string | null; amount: number; }
export interface RecurringMatchCandidate {
  recurringEntryId: string; seriesName: string; occurrence: RecurringOccurrence;
  transactionId: string; splitLineId: string | null; transactionName: string; date: string;
  currency: RecurringEntry["currency"]; sourceValue: number; amount: number; expectedAmount: number;
  settlementExpected?:number;confidence: number; signals: Record<string, number>; windowStart: string; windowEnd: string;
  identity: "name" | "merchant" | "transfer"; tier: "confirmed" | "suggested"; ambiguous: boolean;
}
function eligibleSources(state: FinanceState, from: string, to: string, asOf: string): MatchSource[] {
  const parts = new Map<string, typeof state.splitLines>();
  for (const line of state.splitLines) { const rows = parts.get(line.transactionId) ?? []; rows.push(line); parts.set(line.transactionId, rows); }
  return state.transactions.filter(t => t.date >= from && t.date <= to && t.date <= asOf).flatMap<MatchSource>(transaction => {
    const lines = parts.get(transaction.id);
    return lines ? lines.filter(l => !l.excluded).map(l => ({ transaction: { ...transaction, kind: l.kind }, splitLineId: l.id, name: l.name, merchantId: l.merchantId, amount: l.amount })) : transaction.excluded ? [] : [{ transaction, splitLineId: null, name: transaction.name, merchantId: transaction.merchantId ?? null, amount: transaction.amount }];
  });
}
export function explainRecurringMatch(state: FinanceState, entry: RecurringEntry, occurrence: RecurringOccurrence, source: MatchSource, asOf: string): Omit<RecurringMatchCandidate, "tier" | "ambiguous" | "amount"> | null {
  if(source.transaction.transferId&&state.transferDetails.some(d=>d.id===source.transaction.transferId&&d.status==='pending'))return null;
  const account = state.accounts.find(a => a.id === source.transaction.accountId)!;
  const config = entry.matching ?? matcherDefaults();
  if (account.currency !== entry.currency || entry.accountId && source.transaction.accountId !== entry.accountId || Math.sign(source.amount) !== (entry.amount > 0 ? 1 : -1)) return null;
  const transfer = source.transaction.transferId ? state.transactions.find(t => t.transferId === source.transaction.transferId && t.id !== source.transaction.id) : null;
  let identity: RecurringMatchCandidate["identity"];
  if (entry.billType === "transfer") {
    if (!transfer || transfer.accountId !== entry.destinationAccountId || source.amount >= 0 || source.splitLineId) return null;
    identity = "transfer";
  } else {
    if (transfer || ["funds_movement", "cc_payment", "loan_payment", "investment_contribution"].includes(source.transaction.kind)) return null;
    if (entry.merchantId ? entry.merchantId !== source.merchantId : !matcherKnownNames(entry).has(normalizeMatcherName(source.name))) return null;
    identity = entry.merchantId ? "merchant" : "name";
  }
  const window = matcherWindow(entry, occurrence, state, asOf);
  if (source.transaction.date < window.start || source.transaction.date > window.end) return null;
  const expected = expectedOccurrenceAmount(entry, occurrence, state.recurringOccurrences, state.recurringAllocations);
  if (expected <= 0) return null;
  const amount = matcherAmountScore(expected, Math.abs(source.amount), entry.currency, config); if (amount === null) return null;
  const span = Math.max(1, distance(window.start, window.end)), days = Math.min(distance(source.transaction.date, window.dueOn), span);
  const date = rounded(BigInt(2000 * span - days * 1500), BigInt(span));
  const signals = { [identity]: identity === "name" ? 3500 : 4000, amount, date, account: 1000 };
  return { recurringEntryId: entry.id, seriesName: entry.name, occurrence, transactionId: source.transaction.id, splitLineId: source.splitLineId, transactionName: source.name, date: source.transaction.date, currency: entry.currency, sourceValue: Math.abs(source.amount), expectedAmount: expected, confidence: Object.values(signals).reduce((n, v) => n + v, 0), signals, windowStart: window.start, windowEnd: window.end, identity };
}
export function planRecurringMatches(state: FinanceState, options: { from: string; to: string; asOf: string; writeMode: "live" | "backfill"; recurringEntryId?: string; storedOnly?:boolean; includeFuture?:boolean }) {
  const sources = eligibleSources(state, options.from, options.to, options.includeFuture?options.to:options.asOf), entries = state.recurringEntries.filter(e => e.status === "active" && e.matching?.enabled);
  const rejected = new Set(state.recurringMatchRejections.map(r => JSON.stringify([r.recurringEntryId, r.transactionId, r.splitLineId])));
  const confirmed = new Set(state.recurringAllocations.filter(a => a.state === "confirmed" && a.transactionId).map(a => sourceKey(a.transactionId!, a.splitLineId)));
  const openSeries = new Set(state.recurringEntries.filter(e => e.status !== "ended").map(e => e.id)), occurrences = new Map(state.recurringOccurrences.map(o => [o.id, o]));
  const held = new Set(state.recurringAllocations.filter(a => a.transactionId && openSeries.has(occurrences.get(a.occurrenceId)?.recurringEntryId ?? "")).map(a => JSON.stringify([a.occurrenceId,sourceKey(a.transactionId!, a.splitLineId)])));
  const candidates: Omit<RecurringMatchCandidate, "tier" | "ambiguous" | "amount">[] = [];
  let comparisons = 0, openCount = 0;
  for (const entry of entries) {
    const known = matcherKnownNames(entry);
    const identitySources = sources.filter(source => {
      const account = state.accounts.find(a=>a.id===source.transaction.accountId)!;
      return account.currency===entry.currency && (!entry.accountId||entry.accountId===account.id) && Math.sign(source.amount)===(entry.amount>0?1:-1) && (entry.billType==='transfer'||(entry.merchantId?entry.merchantId===source.merchantId:known.has(normalizeMatcherName(source.name))));
    });
    if(!identitySources.length)continue;
    const own = state.recurringOccurrences.filter(o => o.recurringEntryId === entry.id), earliest = [entry.startsOn, ...own.filter(o => o.status === "scheduled").map(o => o.dueOn)].sort()[0];
    const end = addDays(options.asOf, Math.min(recurrenceHalfCycle(entry), entry.matching!.daysEarly));
    const open = (options.storedOnly?own:occurrencesBetween(entry, state.recurringOccurrences, state.recurringAllocations, earliest, end)).filter(o => o.status === "scheduled").sort((a,b)=>a.dueOn.localeCompare(b.dueOn)||a.originalDueOn.localeCompare(b.originalDueOn));
    openCount += open.length;
    if (openCount > 20000) throw new Error("Matching has more than 20,000 open occurrences. Close obsolete obligations or narrow the enabled schedules first.");
    for (const source of identitySources) {
      const key = sourceKey(source.transaction.id, source.splitLineId);
      if (confirmed.has(key) || rejected.has(JSON.stringify([entry.id, source.transaction.id, source.splitLineId]))) continue;
      // Cheap identity checks precede the occurrence walk and its date math.
      if(source.transaction.transferId&&state.transferDetails.some(d=>d.id===source.transaction.transferId&&d.status==='pending'))continue;
      const account = state.accounts.find(a => a.id === source.transaction.accountId)!;
      if (account.currency !== entry.currency || entry.accountId && entry.accountId !== account.id || Math.sign(source.amount) !== (entry.amount > 0 ? 1 : -1)) continue;
      if (entry.billType !== "transfer" && (entry.merchantId ? entry.merchantId !== source.merchantId : !matcherKnownNames(entry).has(normalizeMatcherName(source.name)))) continue;
      let best: typeof candidates[number] | null = null;
      for (const occurrence of open) {
        if(held.has(JSON.stringify([occurrence.id,key])))continue;
        if (++comparisons > 1_000_000) throw new Error("Too many matching comparisons. Narrow the transaction date range before reviewing.");
        const match = explainRecurringMatch(state, entry, occurrence, source, options.asOf);
        if (!match || match.confidence < 6000) continue;
        if (!best || distance(match.date, occurrence.snoozedUntil && occurrence.snoozedUntil > occurrence.dueOn ? occurrence.snoozedUntil : occurrence.dueOn) < distance(best.date, best.occurrence.snoozedUntil && best.occurrence.snoozedUntil > best.occurrence.dueOn ? best.occurrence.snoozedUntil : best.occurrence.dueOn)) best = match;
      }
      if (best) candidates.push(best);
      if (candidates.length > 20000) throw new Error("More than 20,000 matching candidates. Narrow the transaction date range.");
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence || a.occurrence.id.localeCompare(b.occurrence.id) || sourceKey(a.transactionId, a.splitLineId).localeCompare(sourceKey(b.transactionId, b.splitLineId)));
  const usedSources = new Set<string>(), usedOccurrences = new Set<string>(), selected: RecurringMatchCandidate[] = [];
  const simulated=structuredClone(state);
  for (const candidate of candidates) {
    const key = sourceKey(candidate.transactionId, candidate.splitLineId);
    if (usedSources.has(key) || usedOccurrences.has(candidate.occurrence.id)) continue;
    const runner = candidates.find(c => sourceKey(c.transactionId, c.splitLineId) === key && c.recurringEntryId !== candidate.recurringEntryId);
    const ambiguous = !!runner && candidate.confidence - runner.confidence < 1500;
    const tier = candidate.confidence >= 8500 && !ambiguous ? "confirmed" : "suggested";
    const entry = entries.find(e => e.id === candidate.recurringEntryId)!;
    if (tier === "suggested" && (entry.billType === "income" || options.writeMode === "backfill")) continue;
    const source = sources.find(s => sourceKey(s.transaction.id, s.splitLineId) === key)!;
    let remaining: number;
    try { remaining = paymentCapacity(simulated, source.transaction, source.splitLineId).remaining; } catch { continue; }
    const expected=expectedOccurrenceAmount(entry,candidate.occurrence,simulated.recurringOccurrences,simulated.recurringAllocations);
    const paid = sumMinorUnits(simulated.recurringAllocations.filter(a => a.occurrenceId === candidate.occurrence.id && a.state === "confirmed").map(a => a.amount));
    const due = Math.max(0, expected - paid), amount = due > 0 ? Math.min(remaining, due) : remaining;
    if (!amount) continue;
    usedSources.add(key); usedOccurrences.add(candidate.occurrence.id);
    if (!options.recurringEntryId || options.recurringEntryId === candidate.recurringEntryId) {
      selected.push({ ...candidate, ambiguous, tier, amount, settlementExpected:expected });
      const ownOccurrence={...candidate.occurrence};
      if(tier==='confirmed')ownOccurrence.expectedAmount=ownOccurrence.expectedAmount??expected;
      simulated.recurringAllocations.push({id:`planned:${selected.length}`,ownerId:entry.ownerId,occurrenceId:ownOccurrence.id,transactionId:candidate.transactionId,splitLineId:candidate.splitLineId,amount,currency:entry.currency,sourceAmount:amount,sourceCurrency:entry.currency,state:tier,source:'auto_matched',paidOn:candidate.date,conversion:null,requestFingerprint:null});
      if(tier==='confirmed'){
        const amounts=simulated.recurringAllocations.filter(a=>a.occurrenceId===ownOccurrence.id&&a.state==='confirmed').map(a=>a.amount);
        const closed=recurringCloseWorthy(entry,ownOccurrence.expectedAmount!,amounts);
        ownOccurrence.status=closed?'paid':'scheduled';ownOccurrence.closedSource=closed?'auto':null;
      }
      simulated.recurringOccurrences=simulated.recurringOccurrences.filter(o=>o.id!==ownOccurrence.id).concat(ownOccurrence);
    }
  }
  return { rows: selected, comparisons, contextCandidates: candidates.length, openOccurrences: openCount };
}

export function recurringCloseWorthy(entry: RecurringEntry, expected: number, amounts: number[]) {
  if (!entry.matching?.enabled) return amounts.length > 0 && sumMinorUnits(amounts) >= expected;
  if (expected <= 0 || !amounts.length) return false;
  if (amounts.length === 1 && BigInt(Math.abs(amounts[0] - expected)) * 10000n <= BigInt(expected) * matcherPercentUnits(entry.matching.amountTolerancePct)) return true;
  const epsilon = Math.floor(10 ** precision(entry.currency) / 100);
  return sumMinorUnits(amounts) >= expected - epsilon;
}
export function learnMatcherAttach(entry: RecurringEntry, sourceName: string, rawSourceAmount: number, expected: number, confirmedAmounts: number[]): RecurringMatcherSettings | null {
  if (!entry.matching) return null;
  const next = { ...entry.matching, aliases: [...entry.matching.aliases] };
  if (!entry.merchantId && !matcherKnownNames(entry).has(normalizeMatcherName(sourceName)) && next.aliases.length < 1000) next.aliases.push(sourceName);
  if (expected > 0 && confirmedAmounts.length === 1 && recurringCloseWorthy(entry, expected, confirmedAmounts)) {
    const numerator = BigInt(Math.abs(rawSourceAmount - expected)) * 10000n, denominator = BigInt(expected);
    if (numerator > matcherPercentUnits(next.amountTolerancePct) * denominator && numerator > matcherPercentUnits(next.learnedTolerancePct) * denominator && numerator <= 2500n * denominator) {
      const tenths = rounded(numerator, denominator * 10n); next.learnedTolerancePct = `${Math.floor(tenths / 10)}.${tenths % 10}`;
    }
  }
  return next;
}
export function validateMatcherWorkspace(state: FinanceState) {
  const entries = new Set(state.recurringEntries.map(e => e.id)), transactions = new Map(state.transactions.map(t => [t.id, t])), parts = new Map(state.splitLines.map(l => [l.id, l])), pairs = new Set<string>();
  for (const row of state.recurringMatchRejections) {
    if (!entries.has(row.recurringEntryId) || !transactions.has(row.transactionId) || row.splitLineId && parts.get(row.splitLineId)?.transactionId !== row.transactionId) throw new Error("Match rejection references a missing or inconsistent schedule/source.");
    const key = JSON.stringify([row.recurringEntryId, row.transactionId, row.splitLineId]); if (pairs.has(key)) throw new Error("Duplicate recurring match rejections."); pairs.add(key);
  }
}

export function applyRecurringMatchPlan(state:FinanceState,rows:RecurringMatchCandidate[],owner:string,options:{id?:()=>string;timestamp?:string}={}){
 if(rows.length>300)throw new Error('This review has more than 300 matches. Review a narrower schedule or date range before saving.');
 const next=structuredClone(state),id=options.id??(()=>crypto.randomUUID()),timestamp=options.timestamp??new Date().toISOString();
 for(const candidate of rows){
  const entry=next.recurringEntries.find(e=>e.id===candidate.recurringEntryId)!,stored=next.recurringOccurrences.find(o=>o.id===candidate.occurrence.id),occurrence={...candidate.occurrence,id:stored?.id??id()},amount=candidate.amount,source=next.transactions.find(t=>t.id===candidate.transactionId)!;
  const row:RecurringAllocation={id:id(),ownerId:owner,occurrenceId:occurrence.id,transactionId:source.id,splitLineId:candidate.splitLineId,amount,currency:entry.currency,sourceAmount:amount,sourceCurrency:entry.currency,state:candidate.tier,source:'auto_matched',paidOn:source.date,conversion:resolvePaymentConversion(next,source.accountId,entry.currency,amount,source.date),requestFingerprint:null,matchConfidence:candidate.confidence,matchSignals:{version:1,identity:candidate.identity,signals:candidate.signals,expectedAmount:candidate.expectedAmount,settlementExpected:candidate.settlementExpected??candidate.expectedAmount,sourceValue:candidate.sourceValue,sourceName:candidate.transactionName,windowStart:candidate.windowStart,windowEnd:candidate.windowEnd,ambiguous:candidate.ambiguous}};
  next.recurringAllocations.push(row);
  if(row.state==='confirmed'){occurrence.expectedAmount=occurrence.expectedAmount??candidate.settlementExpected??expectedOccurrenceAmount(entry,occurrence,next.recurringOccurrences,next.recurringAllocations);const paid=recurringCloseWorthy(entry,occurrence.expectedAmount,next.recurringAllocations.filter(a=>a.occurrenceId===occurrence.id&&a.state==='confirmed').map(a=>a.amount));occurrence.status=paid?'paid':'scheduled';occurrence.closedAt=paid?timestamp:null;occurrence.closedSource=paid?'auto':null;}
  next.recurringOccurrences=next.recurringOccurrences.filter(o=>o.id!==occurrence.id).concat(occurrence);
 }
 return next;
}
