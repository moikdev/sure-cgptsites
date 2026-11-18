import { sumMinorUnits, today, validDate, type RecurrenceRule, type RecurringAllocation, type RecurringEntry, type RecurringOccurrence } from "./finance.ts";
import {recurringHistoryFloor} from './recurring-history.ts';
const DAY = 86_400_000;
const epoch = (value: string) => Date.parse(`${value}T00:00:00Z`);
const iso = (value: number) => new Date(value).toISOString().slice(0, 10);
export function addDays(value: string, days: number) { return iso(epoch(value) + days * DAY); }
function daysInMonth(year: number, month: number) { return new Date(Date.UTC(year, month + 1, 0)).getUTCDate(); }
function inMonth(rule: RecurrenceRule, year: number, month: number): string | null {
  const last = daysInMonth(year, month);
  if (rule.dayOfMonth !== null) return iso(Date.UTC(year, month, rule.dayOfMonth === -1 ? last : Math.min(last, rule.dayOfMonth)));
  if (rule.weekday === null || rule.weekdayOrdinal === null) return null;
  if (rule.weekdayOrdinal === -1) { const d = new Date(Date.UTC(year, month, last)); return iso(d.getTime() - ((d.getUTCDay() - rule.weekday + 7) % 7) * DAY); }
  const first = new Date(Date.UTC(year, month, 1)), day = 1 + ((rule.weekday - first.getUTCDay() + 7) % 7) + 7 * (rule.weekdayOrdinal - 1);
  return day <= last ? iso(Date.UTC(year, month, day)) : null;
}
export function validateRule(rule: RecurrenceRule) {
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > 1200) throw new Error("Repeat intervals must be between 1 and 1,200.");
  if (rule.frequency === "weekly") {
    if (rule.weekday === null || rule.dayOfMonth !== null || rule.weekdayOrdinal !== null || rule.monthOfYear !== null) throw new Error("Weekly schedules need a weekday only.");
  } else {
    if ((rule.dayOfMonth !== null) === (rule.weekday !== null) || (rule.weekday !== null) !== (rule.weekdayOrdinal !== null)) throw new Error("Choose a day of month or an ordinal weekday for this schedule.");
    if (rule.frequency === "yearly" ? rule.monthOfYear === null : rule.monthOfYear !== null) throw new Error("Only yearly schedules need a month of year.");
  }
}
export function validateRecurringEntry(entry: Pick<RecurringEntry, "rules" | "anchorDate" | "expectedDayOfMonth" | "endMode" | "endOn" | "endAfterCount" | "accountId" | "destinationAccountId" | "billType" | "status" | "amount">) {
  entry.rules.forEach(validateRule);
  if (!validDate(entry.anchorDate)) throw new Error("Choose a valid schedule start date.");
  if (entry.endMode === "on_date" && (!entry.endOn || entry.endOn < entry.anchorDate)) throw new Error("The end date must be on or after the schedule start.");
  if (entry.endMode === "after_count" && (!entry.endAfterCount || entry.endAfterCount < 1 || entry.endAfterCount > 600)) throw new Error("Choose between 1 and 600 occurrences.");
  if (entry.billType === "transfer" && entry.status === "active" && (!entry.accountId || !entry.destinationAccountId || entry.accountId === entry.destinationAccountId)) throw new Error("Active recurring transfers need two different accounts.");
  if (entry.billType === "transfer" && entry.amount > 0) throw new Error("Recurring transfer amounts must be outgoing.");
  if (entry.billType === "income" && entry.amount < 0) throw new Error("An income schedule needs an incoming amount.");
  if (["bill", "subscription", "installment"].includes(entry.billType) && entry.amount > 0) throw new Error("Bills and subscriptions need an outgoing amount.");
}
function rawDates(rule: RecurrenceRule, entry: RecurringEntry, from: string, to: string, phase = false): string[] {
  const dates: string[] = [], anchor = new Date(`${entry.anchorDate}T00:00:00Z`), start = new Date(`${from}T00:00:00Z`), end = new Date(`${to}T00:00:00Z`);
  if (entry.weekendAdjust === "skip" && rule.weekday !== null && [0, 6].includes(rule.weekday)) return dates;
  if (rule.frequency === "weekly") {
    const base = anchor.getTime() + ((rule.weekday! - anchor.getUTCDay() + 7) % 7) * DAY, step = 7 * rule.interval * DAY;
    for (let time = base + (phase ? Math.ceil((start.getTime() - base) / step) : Math.max(0, Math.ceil((start.getTime() - base) / step))) * step; time <= end.getTime(); time += step) dates.push(iso(time));
  } else if (rule.frequency === "monthly") {
    const base = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth(), min = start.getUTCFullYear() * 12 + start.getUTCMonth(), max = end.getUTCFullYear() * 12 + end.getUTCMonth();
    for (let index = base + (phase ? Math.ceil((min - base) / rule.interval) : Math.max(0, Math.ceil((min - base) / rule.interval))) * rule.interval; index <= max; index += rule.interval) { const date = inMonth(rule, Math.floor(index / 12), index % 12); if (date && date >= from && date <= to && (phase || date >= entry.anchorDate)) dates.push(date); }
  } else {
    const base = anchor.getUTCFullYear();
    for (let year = base + (phase ? Math.ceil((start.getUTCFullYear() - base) / rule.interval) : Math.max(0, Math.ceil((start.getUTCFullYear() - base) / rule.interval))) * rule.interval; year <= end.getUTCFullYear(); year += rule.interval) { const date = inMonth(rule, year, rule.monthOfYear! - 1); if (date && date >= from && date <= to && (phase || date >= entry.anchorDate)) dates.push(date); }
  }
  return dates;
}
export interface OccurrencePair { originalDueOn: string; dueOn: string; }
function pairedSchedule(entry: RecurringEntry, from: string, to: string, phase = false): OccurrencePair[] {
  if (!validDate(from) || !validDate(to) || from > to) return [];
  validateRecurringEntry(entry);
  const rules = entry.rules.length ? entry.rules : [{ frequency: "monthly" as const, interval: 1, dayOfMonth: entry.expectedDayOfMonth, weekday: null, weekdayOrdinal: null, monthOfYear: null }];
  const searchFrom = entry.endMode === "after_count" ? addDays(entry.anchorDate, -3) : addDays(from, -3), searchTo = addDays(to, 3);
  const raw = [...new Set(rules.flatMap(rule => rawDates(rule, entry, searchFrom, searchTo, phase)))].sort();
  let pairs = raw.filter(date => phase && entry.endMode !== "after_count" || date >= entry.anchorDate).flatMap(originalDueOn => {
    const weekday = new Date(`${originalDueOn}T00:00:00Z`).getUTCDay(); let dueOn = originalDueOn;
    if ([0, 6].includes(weekday)) {
      if (entry.weekendAdjust === "skip") return [];
      if (entry.weekendAdjust === "before") dueOn = addDays(originalDueOn, weekday === 6 ? -1 : -2);
      if (entry.weekendAdjust === "after") dueOn = addDays(originalDueOn, weekday === 6 ? 2 : 1);
    }
    return entry.endMode === "on_date" && entry.endOn && dueOn > entry.endOn ? [] : [{ originalDueOn, dueOn }];
  });
  if (entry.endMode === "after_count") pairs = pairs.slice(0, entry.endAfterCount!);
  return pairs.filter(pair => (phase || pair.originalDueOn >= entry.startsOn) && pair.dueOn >= from && pair.dueOn <= to);
}
export function schedulePairs(entry:RecurringEntry,from:string,to:string){return pairedSchedule(entry,from,to);}
// Cadence phase extends backward for evidence-based history reconstruction.
export function schedulePhasePairs(entry:RecurringEntry,from:string,to:string){return pairedSchedule(entry,from,to,true).filter(p=>validDate(p.originalDueOn)&&validDate(p.dueOn));}
export function expectedOccurrenceAmount(entry: RecurringEntry, occurrence: RecurringOccurrence, occurrences: RecurringOccurrence[], allocations: RecurringAllocation[]) {
  if (occurrence.expectedAmount !== null) return occurrence.expectedAmount;
  if (entry.amountStrategy === "average" && entry.expectedAmountAvg !== null) return entry.expectedAmountAvg;
  if (entry.amountStrategy === "last") {
    const prior = occurrences.filter(o => o.recurringEntryId === entry.id && o.status === "paid" && o.originalDueOn < occurrence.originalDueOn).sort((a, b) => b.originalDueOn.localeCompare(a.originalDueOn));
    for (const previous of prior) { const paid = sumMinorUnits(allocations.filter(a => a.occurrenceId === previous.id && a.state === "confirmed").map(a => a.amount)); if (paid) return paid; }
  }
  return Math.abs(entry.amount);
}
// Payment progress and calendar state are independent: a partial bill can be late.
export function occurrenceScheduleState(entry: RecurringEntry, occurrence: RecurringOccurrence, asOf = today()) {
  const due = occurrence.snoozedUntil && occurrence.snoozedUntil > occurrence.dueOn ? occurrence.snoozedUntil : occurrence.dueOn;
  return occurrence.status !== "scheduled" ? occurrence.status : asOf > addDays(due, entry.overdueGraceDays) ? "overdue" : asOf >= addDays(due, -entry.notifyDaysBefore) ? "due" : "upcoming";
}
export function occurrenceDetails(entry: RecurringEntry, occurrence: RecurringOccurrence, occurrences: RecurringOccurrence[], allocations: RecurringAllocation[], asOf = today()) {
  const expected = expectedOccurrenceAmount(entry, occurrence, occurrences, allocations), paid = sumMinorUnits(allocations.filter(a => a.occurrenceId === occurrence.id && a.state === "confirmed").map(a => a.amount));
  const dueOn = occurrence.snoozedUntil && occurrence.snoozedUntil > occurrence.dueOn ? occurrence.snoozedUntil : occurrence.dueOn;
  const state = occurrence.status === "scheduled" && paid > 0 && paid < expected ? "partial" : occurrenceScheduleState(entry, occurrence, asOf);
  return { expected, paid, remaining: Math.max(0, expected - paid), dueOn, state };
}
export function recurrenceHalfCycle(entry: RecurringEntry) {
  const perYear = (entry.rules.length ? entry.rules : [{ frequency: "monthly", interval: 1 }]).reduce((sum, rule) => sum + (rule.frequency === "weekly" ? 365.25 / 7 : rule.frequency === "monthly" ? 12 : 1) / rule.interval, 0);
  return Math.max(1, Math.floor((Math.floor(365.25 / perYear) - 1) / 2));
}
export function occurrencesBetween(entry: RecurringEntry, stored: RecurringOccurrence[], allocations: RecurringAllocation[], from: string, to: string): RecurringOccurrence[] {
  const own = stored.filter(o => o.recurringEntryId === entry.id), pairs = entry.status === "active" ? schedulePairs(entry, from, to) : [];
  const existing = new Map(own.map(o => [o.originalDueOn, o])), stoodIn = new Set<string>(), reach = recurrenceHalfCycle(entry);
  // Closed or paid history kept after a schedule edit stands in for the nearest old cycle.
  const nearby = entry.status === "active" ? schedulePairs(entry, addDays(from, -reach) < "1900-01-01" ? "1900-01-01" : addDays(from, -reach), addDays(to, reach) > "2199-12-31" ? "2199-12-31" : addDays(to, reach)) : [];
  const nearbyOriginals = new Set(nearby.map(pair => pair.originalDueOn));
  const firstByDue = new Map<string, OccurrencePair>();
  for (const pair of nearby) if (!firstByDue.has(pair.dueOn)) firstByDue.set(pair.dueOn, pair);
  const dueDates = [...firstByDue.keys()].sort();
  for (const occurrence of own) {
    if (nearbyOriginals.has(occurrence.originalDueOn)) continue;
    let low = 0, high = dueDates.length;
    while (low < high) { const mid = Math.floor((low + high) / 2); if (dueDates[mid] < occurrence.dueOn) low = mid + 1; else high = mid; }
    const closest = [dueDates[low - 1], dueDates[low]].filter((date): date is string => !!date).map(date => firstByDue.get(date)!).filter(pair => Math.abs(epoch(pair.dueOn) - epoch(occurrence.dueOn)) <= reach * DAY).sort((a, b) => Math.abs(epoch(a.dueOn) - epoch(occurrence.dueOn)) - Math.abs(epoch(b.dueOn) - epoch(occurrence.dueOn)) || a.dueOn.localeCompare(b.dueOn))[0];
    if (closest) stoodIn.add(closest.originalDueOn);
  }
  const floor=recurringHistoryFloor(entry);
  const generated = pairs.filter(pair => (!floor||pair.dueOn>=floor)&&!existing.has(pair.originalDueOn) && !stoodIn.has(pair.originalDueOn)).map(pair => ({ ...pair, id: `virtual:${entry.id}:${pair.originalDueOn}`, ownerId: entry.ownerId, recurringEntryId: entry.id, currency: entry.currency, expectedAmount: null, status: "scheduled" as const, snoozedUntil: null, closedAt: null, closedSource: null, notes: "" }));
  return [...own, ...generated].filter(o => { const due = o.snoozedUntil && o.snoozedUntil > o.dueOn ? o.snoozedUntil : o.dueOn; return due >= from && due <= to; }).sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.originalDueOn.localeCompare(b.originalDueOn));
}
