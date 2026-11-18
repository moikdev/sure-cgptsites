import { precision, today, type FinanceState } from "./finance.ts";
import type { RecurringPriceChange } from "./recurring-price-types.ts";

export function materialPriceChange(previous: number, next: number) {
  return previous > 0 && (BigInt(next) - BigInt(previous) < 0n ? BigInt(previous) - BigInt(next) : BigInt(next) - BigInt(previous)) * 10n >= BigInt(previous);
}
export type DetectedRecurringPrice = Omit<RecurringPriceChange, "id" | "ownerId"> & {
  seriesName: string; material: boolean;
  observations: { occurrenceId: string; dueOn: string; paidOn: string | null; amount: number; transactionId: string | null }[];
};

/** Observe two single-payment settlements; declared schedules are never repriced. */
export function detectRecurringPrices(state: FinanceState, asOf = today(), seriesId?: string, includeFuture = false): DetectedRecurringPrice[] {
  const own = new Map<string, typeof state.recurringOccurrences>();
  for (const occurrence of state.recurringOccurrences) {
    if (occurrence.status !== "paid") continue;
    const rows = own.get(occurrence.recurringEntryId) ?? []; rows.push(occurrence); own.set(occurrence.recurringEntryId, rows);
  }
  const confirmed = new Map<string, typeof state.recurringAllocations>();
  for (const allocation of state.recurringAllocations) if (allocation.state === "confirmed") {
    const rows = confirmed.get(allocation.occurrenceId) ?? []; rows.push(allocation); confirmed.set(allocation.occurrenceId, rows);
  }
  const changes: DetectedRecurringPrice[] = [];
  for (const series of state.recurringEntries) {
    if (seriesId && series.id !== seriesId || series.status !== "active" || series.amount >= 0) continue;
    const recent = [...(own.get(series.id) ?? [])].sort((a, b) => b.dueOn.localeCompare(a.dueOn) || b.originalDueOn.localeCompare(a.originalDueOn) || a.id.localeCompare(b.id)).slice(0, 2);
    if (recent.length !== 2) continue;
    const settlements = recent.map(o => confirmed.get(o.id) ?? []);
    if (settlements.some(rows => rows.length !== 1)) continue;
    const payments = settlements.map(rows => rows[0]);
    if (payments.some((p, i) => p.currency !== series.currency || !includeFuture && (p.paidOn ?? recent[i].dueOn) > asOf)) continue;
    // Upstream EPSILON is 0.01 major currency units; whole-unit currencies
    // therefore need equality, while a three-place currency allows 10 minors.
    const epsilon = Math.floor(10 ** precision(series.currency) / 100);
    const latest = payments[0].amount, previous = Math.abs(series.amount);
    if (Math.abs(latest - payments[1].amount) > epsilon || Math.abs(latest - previous) <= epsilon) continue;
    const history = state.recurringPriceChanges.filter(p => p.recurringEntryId === series.id);
    if (history.some(p => p.effectiveOn === recent[0].dueOn)) continue;
    const last = [...history].sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn))[0];
    if (last?.currency === series.currency && last.newAmount === latest) continue;
    changes.push({ recurringEntryId: series.id, effectiveOn: recent[0].dueOn, previousAmount: previous, newAmount: latest, currency: series.currency, source: "detected", transactionId: payments[0].transactionId, seriesName: series.name, material: materialPriceChange(previous, latest), observations: recent.map((o, i) => ({ occurrenceId: o.id, dueOn: o.dueOn, paidOn: payments[i].paidOn, amount: payments[i].amount, transactionId: payments[i].transactionId })) });
  }
  return changes.sort((a, b) => a.recurringEntryId.localeCompare(b.recurringEntryId));
}

export function validateRecurringPrices(state: FinanceState) {
  const series = new Set(state.recurringEntries.map(e => e.id)), transactions = new Set(state.transactions.map(t => t.id)), keys = new Set<string>();
  for (const change of state.recurringPriceChanges) {
    if (!series.has(change.recurringEntryId)) throw new Error("Price history references a missing recurring schedule.");
    if (change.transactionId && !transactions.has(change.transactionId)) throw new Error("Price history references a missing transaction.");
    const key = JSON.stringify([change.recurringEntryId, change.effectiveOn]);
    if (keys.has(key)) throw new Error("A recurring schedule can have only one price-history record on each effective date.");
    keys.add(key);
  }
}
