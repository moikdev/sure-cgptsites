import test from "node:test";
import assert from "node:assert/strict";
import { emptyState, accountBalance, type FinanceState } from "../lib/finance.ts";
import { loanTermsSchema } from "../lib/loan-schema.ts";
import { loanSchedule } from "../lib/loans.ts";
import { loanPayoff, createLoanProjectionReport, loanProjectionPage, loanProjectionCSV } from "../lib/loan-projection.ts";
import { parseSitesBackup, workspaceState, remapWorkspace } from "../lib/workspace.ts";
const terms = (patch = {}) => loanTermsSchema.parse({ initialBalance: 12000000, startDate: "2025-01-01", termMonths: 36, annualRate: "6", rateType: "fixed", ...patch });
const options = { asOf: "2026-01-15", extraAmount: 0, frequency: "monthly" as const };
const principalAt = (t = terms(), date = options.asOf) => loanSchedule(t)!.payments.findLast(p => p.date <= date)?.endingBalance ?? t.initialBalance!;
test("a loan exactly on contract retains its future payments and maturity", () => {
  const t = terms(), contract = loanSchedule(t)!, p = loanPayoff(t, principalAt(t), options);
  assert.equal(p.converged, true); assert.equal(p.payoffDate, contract.payoffDate); assert.equal(p.monthsSavedAgainstContract, 0); assert.equal(p.interestSavedAgainstContract, 0);
  const remaining = contract.payments.filter(p => p.date > options.asOf); assert.deepEqual(p.payments.map(p => p.payment), remaining.map(p => p.payment));
});
test("a smaller current debt keeps the contractual payment and finishes early", () => {
  const t = terms(), p = loanPayoff(t, Math.floor(principalAt(t) / 2), options), contract = loanSchedule(t)!;
  assert.equal(p.payments[0].payment, contract.payments.find(p => p.date > options.asOf)!.payment); assert.ok(p.monthsSavedAgainstContract > 0); assert.ok(p.interestSavedAgainstContract > 0); assert.ok(p.payoffDate! < contract.payoffDate!);
});
test("a debt above schedule carries an honest balloon without an invented extension", () => {
  const p = loanPayoff(terms(), principalAt() * 2, options);
  assert.equal(p.converged, false); assert.equal(p.payoffDate, null); assert.equal(p.totalCost, null); assert.ok(p.balloonAmount > 0); assert.equal(p.payments.at(-1)!.date, p.maturity); assert.equal(p.monthsSavedAgainstContract, 0);
});
test("monthly extra payments shorten payoff and never reamortize the debt", () => {
  const baseline = loanPayoff(terms(), principalAt(), options), extra = loanPayoff(terms(), principalAt(), { ...options, extraAmount: 100000 });
  assert.ok(extra.payments.length < baseline.payments.length); assert.ok(extra.totalInterest < baseline.totalInterest); assert.equal(extra.payments[0].payment - baseline.payments[0].payment, 100000); assert.ok(extra.totalExtra > 0);
});
test("an extra that rescues a balloon is not compared against fictitious baseline payoff", () => {
  const state = fixture(), account = state.accounts[0]; account.openingBalance = -24000000;
  const result = createLoanProjectionReport(state, account.id, { ...options, extraAmount: 2000000 });
  assert.equal(result.baseline.converged, false); assert.equal(result.scenario!.converged, true); assert.deepEqual(result.comparison, { monthsSooner: null, interestSaved: null, totalCostSaved: null });
});
test("the final payment and applied extra stop exactly at settlement", () => {
  const p = loanPayoff(terms(), 100, { ...options, extraAmount: 1_000_000_000_000, frequency: "weekly" });
  assert.equal(p.payments.length, 1); assert.equal(p.payments[0].endingBalance, 0); assert.equal(p.totalExtra, 0); assert.equal(p.totalPayments, 101); assert.equal(p.totalCost, 101);
});
test("a final extra is capped to the amount above the contract payment", () => {
  const t = terms(), contracted = loanSchedule(t)!.payments.find(p => p.date > options.asOf)!.payment;
  const p = loanPayoff(t, contracted * 2, { ...options, extraAmount: 99999999 }); assert.equal(p.payments.length, 1); assert.equal(p.totalExtra, p.totalPayments - contracted); assert.ok(p.totalExtra < 99999999);
});
test("weekly extra counts follow calendar dates and include each closing date", () => {
  const p = loanPayoff(terms({ startDate: "2026-01-01", termMonths: 36 }), 12000000, { asOf: "2027-01-15", extraAmount: 100, frequency: "weekly" });
  assert.deepEqual(p.payments.slice(0, 5).map(p => p.extraOccurrences), [3, 4, 4, 5, 4]);
});
test("fortnightly extras are dated rather than a flat monthly multiplier", () => {
  const p = loanPayoff(terms({ startDate: "2026-01-01", termMonths: 36 }), 12000000, { asOf: "2027-01-15", extraAmount: 100, frequency: "fortnightly" });
  assert.deepEqual(p.payments.slice(0, 7).map(p => p.extraOccurrences), [2, 2, 2, 2, 2, 2, 3]);
});
test("the first dated extra falls the day after as-of, including a payment date", () => {
  const p = loanPayoff(terms(), 12000000, { asOf: "2026-01-31", extraAmount: 100, frequency: "weekly" }); assert.equal(p.payments[0].extraOccurrences, 1);
});
test("a due date on as-of is already behind the projection", () => {
  const p = loanPayoff(terms(), principalAt(terms(), "2026-02-01"), { ...options, asOf: "2026-02-01" }); assert.equal(p.payments[0].date, "2026-03-01");
});
test("mid-period variable changes do not re-rate the period already open", () => {
  const t = terms({ rateType: "variable", rateChanges: [{ date: "2026-01-10", rate: "12" }] });
  const p = loanPayoff(t, principalAt(t), options); assert.equal(p.payments[0].accrualRate, "6"); assert.equal(p.payments[1].accrualRate, "12"); assert.equal(p.interestSavedAgainstContract, 0);
});
test("a variable loan ahead of schedule follows each changing contract row", () => {
  const t = terms({ rateType: "arm", rateChanges: [{ date: "2026-03-15", rate: "8" }, { date: "2026-08-01", rate: "3" }] });
  const p = loanPayoff(t, Math.floor(principalAt(t) * .8), options), byDate = new Map(loanSchedule(t)!.payments.map(row => [row.date, row.payment]));
  for (const row of p.payments.slice(0, -1)) assert.equal(row.payment, byDate.get(row.date)); assert.equal(p.converged, true); assert.ok(p.monthsSavedAgainstContract > 0);
});
test("all interest day counts reproduce their own remaining contract when on track", () => {
  for (const dayCount of ["thirty_360", "actual_365", "actual_actual"] as const) {
    const t = terms({ dayCount, startDate: "2024-01-31" }), p = loanPayoff(t, principalAt(t), options); assert.equal(p.interestSavedAgainstContract, 0); assert.equal(p.monthsSavedAgainstContract, 0);
  }
});
test("insurance and down payment do not become projected principal or interest", () => {
  const base = loanPayoff(terms(), principalAt(), options), insured = loanPayoff(terms({ insuranceRate: "10", insuranceType: "level_term", downPayment: 100000 }), principalAt(), options); assert.deepEqual(insured, base);
});
test("settled, matured, missing and rounded-zero contracts remain distinct", () => {
  assert.equal(loanPayoff(terms(), 0, options).status, "settled"); assert.equal(loanPayoff(null, 100, options).status, "missing_terms");
  const matured = loanPayoff(terms({ termMonths: 1 }), 100, options); assert.equal(matured.status, "matured"); assert.equal(matured.balloonAmount, 100); assert.equal(matured.payoffDate, null);
  assert.equal(loanPayoff(terms({ initialBalance: 1, annualRate: "0", termMonths: 1200 }), 1, { ...options, asOf: "2025-01-01" }).status, "zero_payment");
});
test("zero rate preserves every unit without invented interest", () => {
  const t = terms({ initialBalance: 1001, annualRate: "0", termMonths: 12 }); const p = loanPayoff(t, 501, { ...options, asOf: "2025-03-15", extraAmount: 10 }); assert.equal(p.totalInterest, 0); assert.equal(p.totalPayments, 501); assert.equal(p.balloonAmount, 0);
});
test("negative amortization remains visible rather than reporting false principal repaid", () => {
  const t = terms({ annualRate: "100", termMonths: 12 }); const p = loanPayoff(t, 100000000, { ...options, asOf: "2025-01-01" }); assert.ok(p.payments[0].principal < 0); assert.ok(p.payments[0].endingBalance > p.payments[0].openingBalance); assert.equal(p.converged, false);
});
test("invalid dates, extras, frequencies and unsafe growth fail explicitly", () => {
  for (const input of [{ ...options, extraAmount: -1 }, { ...options, extraAmount: .5 }, { ...options, extraAmount: Infinity }, { ...options, frequency: "daily" }, { ...options, asOf: "2026-02-30" }]) assert.throws(() => loanPayoff(terms(), 10000, input as typeof options));
  assert.throws(() => loanPayoff(terms(), -1, options)); assert.throws(() => loanPayoff(terms(), 10000, { ...options, asOf: "2024-01-01" }));
  assert.throws(() => loanPayoff(terms({ annualRate: "100", termMonths: 120 }), 1_000_000_000_000, { ...options, asOf: "2025-01-01" }), /money range/);
});
function fixture(): FinanceState {
  return { ...structuredClone(emptyState), profile: { ownerId: "one", name: "One", currency: "USD", revision: 3 }, accounts: [{ id: "loan", ownerId: "one", name: "Mortgage", type: "loan", currency: "USD", openingDate: "2025-01-01", openingBalance: -principalAt(), archived: 0, loanTerms: terms() }] };
}
test("reports use the actual dated signed balance without touching the workspace", () => {
  const s = fixture(); s.valuations.push({ id: "v", ownerId: "one", accountId: "loan", date: "2026-01-10", amount: -5000000, name: "Actual principal", kind: "reconciliation" });
  s.transactions.push({ id: "t", ownerId: "one", accountId: "loan", date: "2026-01-12", amount: 100000, name: "Principal paid", kind: "loan_payment", transferId: null, categoryId: null, notes: "", importKey: null });
  const before = structuredClone(s), result = createLoanProjectionReport(s, "loan", options); assert.equal(result.recordedBalance, -4900000); assert.equal(result.baseline.currentPrincipal, 4900000); assert.equal(accountBalance(s.accounts[0], s, options.asOf), -4900000); assert.deepEqual(s, before);
});
test("context, recorded date and stale revision guards reject an invalid report", () => {
  const s = fixture(); assert.throws(() => createLoanProjectionReport(s, "other", options), /not found/); assert.throws(() => createLoanProjectionReport(s, "loan", options, 0), /workspace changed/);
  assert.throws(() => createLoanProjectionReport(s, "loan", { ...options, asOf: "2199-01-01" }), /recorded date/); assert.throws(() => createLoanProjectionReport(s, "loan", { ...options, asOf: "2024-01-01" }), /recorded date/);
  s.accounts[0].type = "checking"; assert.throws(() => createLoanProjectionReport(s, "loan", options), /loan account/);
});
test("paged projections retain full totals and CSV exports every row of both series", () => {
  const s = fixture(); s.accounts[0].loanTerms = terms({ termMonths: 360 }); const report = createLoanProjectionReport(s, "loan", { ...options, extraAmount: 1000 }); const first = loanProjectionPage(report), next = loanProjectionPage(report, 24);
  assert.equal(first.baseline.payments.length, 24); assert.equal(next.baseline.payments[0].number, 25); assert.equal(first.baseline.totalInterest, next.baseline.totalInterest); assert.equal(first.nextOffset, 24);
  assert.equal(loanProjectionCSV(report).trim().split("\r\n").length, 1 + report.baseline.payments.length + report.scenario!.payments.length);
  assert.throws(() => loanProjectionPage(report, 1200)); assert.throws(() => loanProjectionPage(report, -1)); assert.throws(() => loanProjectionPage(report, 1199));
});
test("comparison savings are meaningful only when both projections converge", () => {
  const report = createLoanProjectionReport(fixture(), "loan", { ...options, extraAmount: 100000 }); assert.ok(report.comparison!.monthsSooner! > 0); assert.equal(report.comparison!.interestSaved, report.comparison!.totalCostSaved); assert.ok(report.comparison!.interestSaved! > 0);
});
test("JSON recovery and account remapping preserve recomputed projections", () => {
  const s = fixture(), restored = workspaceState(remapWorkspace(parseSitesBackup(JSON.stringify({ ...s, format: "sure-sites", version: 19 })).data));
  const original = createLoanProjectionReport(s, "loan", { ...options, extraAmount: 10000, frequency: "weekly" });
  const copy = createLoanProjectionReport(restored, restored.accounts[0].id, original.options); assert.deepEqual(copy.baseline, original.baseline); assert.deepEqual(copy.scenario, original.scenario); assert.deepEqual(copy.comparison, original.comparison);
});
