import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, type FinanceState, type RecurringEntry } from "../lib/finance.ts";
import { detectRecurringPrices, materialPriceChange } from "../lib/recurring-prices.ts";
import { parseSitesBackup, remapWorkspace, validateWorkspace, workspaceState } from "../lib/workspace.ts";
import { parseSureExport } from "../lib/sure-export.ts";

const entry: RecurringEntry = { id: "series", ownerId: "one", name: "Subscription", accountId: null, destinationAccountId: null, categoryId: null, merchantId: null, tagIds: [], amount: -10000, currency: "USD", billType: "subscription", status: "active", anchorDate: "2026-01-01", startsOn: "2026-01-01", expectedDayOfMonth: 1, rules: [], endMode: "never", endOn: null, endAfterCount: null, weekendAdjust: "none", amountStrategy: "fixed", expectedAmountMin: null, expectedAmountMax: null, expectedAmountAvg: null, notifyDaysBefore: 3, overdueGraceDays: 3, notes: "", paymentUrl: null, autopay: 0 };
function state(): FinanceState {
  return { ...structuredClone(emptyState), profile: { ownerId: "one", revision: 0, name: "One", currency: "USD" }, recurringEntries: [{ ...entry }], recurringOccurrences: [1, 2].map(i => ({ id: `o${i}`, ownerId: "one", recurringEntryId: entry.id, originalDueOn: `2026-0${i}-01`, dueOn: `2026-0${i}-01`, currency: "USD", expectedAmount: 10000, status: "paid", snoozedUntil: null, closedAt: `2026-0${i}-01T00:00:00Z`, closedSource: "user", notes: "" })), recurringAllocations: [1, 2].map(i => ({ id: `p${i}`, ownerId: "one", occurrenceId: `o${i}`, transactionId: null, splitLineId: null, amount: 12000, currency: "USD", sourceAmount: null, sourceCurrency: null, state: "confirmed", source: "user_created", paidOn: `2026-0${i}-01`, conversion: null, requestFingerprint: null })) };
}
const review = (s = state()) => detectRecurringPrices(s, "2026-02-03");
test("two single-payment settled occurrences propose an observed price with both signals", () => {
  const rows = review(); assert.equal(rows.length, 1); assert.equal(rows[0].effectiveOn, "2026-02-01"); assert.equal(rows[0].previousAmount, 10000); assert.equal(rows[0].newAmount, 12000); assert.equal(rows[0].material, true); assert.deepEqual(rows[0].observations.map(o => o.occurrenceId), ["o2", "o1"]);
});
test("a single unusual charge is not enough to declare a new price", () => {
  const s = state(); s.recurringAllocations[0].amount = 10000; assert.equal(review(s).length, 0); s.recurringOccurrences.pop(); assert.equal(review(s).length, 0);
});
test("only the latest two paid occurrences can establish a new observation", () => {
  const s = state(); s.recurringOccurrences.push({ ...s.recurringOccurrences[1], id: "o3", originalDueOn: "2026-02-02", dueOn: "2026-02-02" }); s.recurringAllocations.push({ ...s.recurringAllocations[1], id: "p3", occurrenceId: "o3", amount: 13000 }); assert.equal(review(s).length, 0);
});
test("partials and multiple confirmed payments do not describe a single price", () => {
  const s = state(); s.recurringAllocations.push({ ...s.recurringAllocations[0], id: "extra", amount: 1 }); assert.equal(review(s).length, 0);
  s.recurringAllocations.pop(); s.recurringOccurrences[0].status = "scheduled"; assert.equal(review(s).length, 0);
});
test("suggested payments cannot create price history or count as a second settlement", () => {
  const s = state(); s.recurringAllocations.push({ ...s.recurringAllocations[0], id: "suggested", state: "suggested" }); assert.equal(review(s).length, 1); s.recurringAllocations[0].state = "suggested"; assert.equal(review(s).length, 0);
});
test("only active outgoing schedules are detected, independent of description or autopay", () => {
  for (const patch of [{ status: "paused" }, { status: "ended" }, { status: "suggested" }, { amount: 10000 }, { amount: 0 }]) { const s = state(); Object.assign(s.recurringEntries[0], patch); assert.equal(review(s).length, 0); }
  const s = state(); s.recurringEntries[0].autopay = 1; s.recurringEntries[0].name = "Renamed"; assert.equal(review(s)[0].seriesName, "Renamed");
});
test("the epsilon is exactly one cent of major currency, with native precision", () => {
  const usd = state(); usd.recurringAllocations[0].amount = 11999; assert.equal(review(usd).length, 1); usd.recurringAllocations[0].amount = 11998; assert.equal(review(usd).length, 0);
  const jpy = state(); jpy.recurringEntries[0].currency = "JPY"; jpy.recurringAllocations.forEach(p => p.currency = "JPY"); jpy.recurringAllocations[0].amount = 11999; assert.equal(review(jpy).length, 0); jpy.recurringAllocations[0].amount = 12000; assert.equal(review(jpy).length, 1);
  const kwd = state(); kwd.recurringEntries[0].currency = "KWD"; kwd.recurringAllocations.forEach(p => p.currency = "KWD"); kwd.recurringAllocations[0].amount = 11990; assert.equal(review(kwd).length, 1); kwd.recurringAllocations[0].amount = 11989; assert.equal(review(kwd).length, 0);
});
test("a change within one cent of the stated price is noise", () => {
  const s = state(); s.recurringAllocations.forEach(p => p.amount = 10001); assert.equal(review(s).length, 0); s.recurringAllocations.forEach(p => p.amount = 10002); assert.equal(review(s).length, 1);
});
test("decreases and the exact ten percent material boundary retain direction", () => {
  const s = state(); s.recurringAllocations.forEach(p => p.amount = 8000); assert.equal(review(s)[0].newAmount, 8000); assert.equal(review(s)[0].material, true);
  for (const [previous, next, expected] of [[10000, 11000, true], [10000, 9000, true], [10000, 10999, false], [10000, 9001, false], [0, 10000, false], [1_000_000_000_000, 900_000_000_000, true]] as const) assert.equal(materialPriceChange(previous, next), expected);
});
const saved = () => ({ id: "history", ownerId: "one", recurringEntryId: "series", effectiveOn: "2026-02-01", previousAmount: 10000, newAmount: 12000, currency: "USD" as const, source: "detected" as const, transactionId: null });
test("an existing effective date prevents duplicate detected or manual history", () => {
  const s = state(); s.recurringPriceChanges.push(saved()); assert.equal(review(s).length, 0); s.recurringPriceChanges[0].source = "user"; assert.equal(review(s).length, 0);
});
test("the most recent known same price suppresses repeat observations on new dates", () => {
  const s = state(); s.recurringPriceChanges.push({ ...saved(), effectiveOn: "2026-01-15" }); assert.equal(review(s).length, 0); s.recurringPriceChanges[0].newAmount = 11000; assert.equal(review(s).length, 1);
});
test("a historical price in another currency cannot mask a new native observation", () => {
  const s = state(); s.recurringPriceChanges.push({ ...saved(), effectiveOn: "2026-01-15", currency: "EUR" }); assert.equal(review(s).length, 1);
});
test("a historical review excludes payments recorded after its as-of date", () => {
  assert.equal(detectRecurringPrices(state(), "2026-01-31").length, 0); const s = state(); s.recurringAllocations[1].paidOn = null; assert.equal(review(s).length, 1); assert.equal(detectRecurringPrices(s, "2026-01-31").length, 0);
});
test("paid-in-advance occurrences can reveal the known next price without changing the schedule", () => {
  const s = state(); s.recurringOccurrences[1].dueOn = "2026-04-01"; const before = structuredClone(s); const rows = review(s); assert.equal(rows[0].effectiveOn, "2026-04-01"); assert.deepEqual(s, before);
});
test("detector ignores snooze labels, honors series scope and never writes records", () => {
  const s = state(); s.recurringOccurrences[1].snoozedUntil = "2026-03-01"; const before = structuredClone(s); assert.equal(review(s)[0].effectiveOn, "2026-02-01"); assert.equal(detectRecurringPrices(s, "2026-02-03", "missing").length, 0); assert.deepEqual(s, before);
});
test("converted payments use their confirmed bill-currency amount, not source cash", () => {
  const s = state(); s.recurringAllocations.forEach(p => { p.sourceCurrency = "EUR"; p.sourceAmount = 9000; }); assert.equal(review(s)[0].newAmount, 12000); s.recurringAllocations[0].currency = "EUR"; assert.equal(review(s).length, 0);
});
test("version-20 recovery preserves immutable prices and remaps series and linked roots", () => {
  const s = state(); s.recurringAllocations = []; s.recurringOccurrences = []; s.recurringPriceChanges.push(saved());
  const parsed = parseSitesBackup(JSON.stringify({ ...s, format: "sure-sites", version: 20 })).data, copy = workspaceState(remapWorkspace(parsed)); assert.deepEqual(copy.recurringPriceChanges.map(({ id, ownerId, recurringEntryId, ...p }) => p), s.recurringPriceChanges.map(({ id, ownerId, recurringEntryId, ...p }) => p)); assert.notEqual(copy.recurringPriceChanges[0].recurringEntryId, "series"); assert.equal(copy.recurringPriceChanges[0].recurringEntryId, copy.recurringEntries[0].id);
});
test("legacy backups default to empty price history, with no fabricated observations", () => {
  const s = state(); const old = JSON.parse(JSON.stringify(s)); delete old.recurringPriceChanges; assert.deepEqual(parseSitesBackup(JSON.stringify({ ...old, format: "sure-sites", version: 1 })).data.recurringPriceChanges, []);
});
test("invalid source links, series, amounts and duplicate dates reject recovery", () => {
  const s = state(); s.recurringAllocations = []; s.recurringOccurrences = []; s.recurringPriceChanges.push(saved()); validateWorkspace(s);
  for (const patch of [{ recurringEntryId: "missing" }, { transactionId: "missing" }, { previousAmount: -1 }, { newAmount: 1.5 }, { source: "automatic" }, { effectiveOn: "2026-02-30" }]) assert.throws(() => validateWorkspace({ ...s, recurringPriceChanges: [{ ...saved(), ...patch }] }));
  assert.throws(() => validateWorkspace({ ...s, recurringPriceChanges: [saved(), { ...saved(), id: "second" }] }), /one price-history/);
});
test("native Sure price-change records retain their own currency, source and independent prices", () => {
  const ndjson = [
    { type:"Account", data:{id:"account",name:"Manual cash",accountable_type:"Depository",currency:"USD",balance:"0",accountable:{}} },
    { type: "RecurringTransaction", data: { id: "r", name: "Imported bill", amount: "100", currency: "USD", bill_type: "subscription", status: "active", expected_day_of_month: 1, anchor_date: "2026-01-01", end_mode: "never" } },
    { type: "RecurringPriceChange", data: { id: "h", recurring_transaction_id: "r", effective_on: "2026-02-01", previous_amount: "90", new_amount: "100", currency: "EUR", source: "user", transaction_id: null } },
  ].map(r => JSON.stringify(r)).join("\n");
  const imported = parseSureExport(ndjson, { name: "Owner", currency: "USD", exportDate: "2026-02-03" }); assert.equal(imported.data.recurringPriceChanges[0].currency, "EUR"); assert.equal(imported.data.recurringPriceChanges[0].previousAmount, 9000); assert.equal(imported.data.recurringEntries[0].amount, -10000); assert.ok(!imported.warnings.some(w => /RecurringPriceChange record.*not imported/.test(w)));
});
test("native split-child source pointers remap to their retained transaction root", () => {
  const records = [
    { type: "Account", data: { id: "a", name: "Cash", accountable_type: "Depository", currency: "USD", balance: "100", accountable: {} } },
    { type: "Transaction", data: { id: "root", account_id: "a", date: "2026-02-01", name: "Combined charge", currency: "USD", amount: "100", split_lines: [{ id: "child", name: "Bill part", amount: "60" }, { id: "other", name: "Other part", amount: "40" }] } },
    { type: "RecurringTransaction", data: { id: "r", name: "Bill", amount: "60", currency: "USD", bill_type: "subscription", status: "active", expected_day_of_month: 1, anchor_date: "2026-01-01", end_mode: "never" } },
    { type: "RecurringPriceChange", data: { id: "h", recurring_transaction_id: "r", effective_on: "2026-02-01", previous_amount: "50", new_amount: "60", currency: "USD", source: "detected", transaction_id: "child" } },
  ];
  const imported = parseSureExport(records.map(r => JSON.stringify(r)).join("\n"), { name: "Owner", currency: "USD", exportDate: "2026-02-03" }).data;
  assert.equal(imported.recurringPriceChanges[0].transactionId, "root"); const copy = remapWorkspace(imported); assert.equal(copy.recurringPriceChanges[0].transactionId, copy.transactions[0].id); assert.notEqual(copy.transactions[0].id, "root");
});
