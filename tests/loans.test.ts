import test from "node:test";
import assert from "node:assert/strict";
import { loanTermsSchema } from "../lib/loan-schema.ts";
import { loanSchedule, loanPaymentDate } from "../lib/loans.ts";
import { importLoanTerms } from "../lib/loan-import.ts";
import { emptyState, accountBalance } from "../lib/finance.ts";
import { parseSitesBackup, remapWorkspace, validateWorkspace } from "../lib/workspace.ts";
import { parseSureExport } from "../lib/sure-export.ts";

const terms = (patch = {}) => loanTermsSchema.parse({ initialBalance: 50_000_000, startDate: "2026-01-01", termMonths: 360, annualRate: "3.5", rateType: "fixed", ...patch });
const run = (patch = {}) => loanSchedule(terms(patch))!;
test("matches Sure's 500,000 / 3.5% / 360-month reference schedule", () => {
  const s = run(); assert.equal(s.payments.length, 360); assert.equal(s.payments[0].payment, 224522);
  assert.equal(s.payments[0].interest, 145833); assert.equal(s.payments[0].principal, 78689);
  assert.equal(s.totalInterest, 30828136); assert.equal(s.totalPaid, 80828136);
  assert.equal(s.payments.at(-1)!.endingBalance, 0);
  assert.equal(s.payments.reduce((n, p) => n + p.principal, 0), 50_000_000);
});
test("monthly dates retain the original day across short and leap months", () => {
  assert.equal(loanPaymentDate("2024-01-31", 1), "2024-02-29"); assert.equal(loanPaymentDate("2024-01-31", 2), "2024-03-31");
  const s = run({ startDate: "2026-01-31", termMonths: 12 }); assert.equal(s.payments[0].date, "2026-02-28"); assert.equal(s.payoffDate, "2027-01-31");
});
test("zero interest and final rounding preserve every minor unit", () => {
  const s = run({ initialBalance: 1001, annualRate: "0", termMonths: 10 });
  assert.equal(s.payments[0].payment, 100); assert.equal(s.payments.at(-1)!.payment, 101); assert.equal(s.totalInterest, 0); assert.equal(s.totalPaid, 1001);
});
test("whole-unit rounding can pay a tiny loan off before its term", () => {
  const s = run({ initialBalance: 10, annualRate: "0", termMonths: 18 }); assert.equal(s.payments.length, 10); assert.equal(s.payoffDate, "2026-11-01");
});
test("a rounded zero payment never drops the outstanding principal", () => {
  const s = run({ initialBalance: 1, annualRate: "0", termMonths: 1200 }); assert.equal(s.payments.length, 1200); assert.equal(s.payments[0].payment, 0); assert.equal(s.payments.at(-1)!.payment, 1);
});
test("missing contract fields preserve metadata without inventing a schedule", () => {
  for (const patch of [{ initialBalance: null }, { startDate: null }, { termMonths: null }, { annualRate: null }, { rateType: null }]) assert.equal(loanSchedule(terms(patch)), null);
});
test("fixed loans retain and ignore recorded variable rates", () => {
  assert.deepEqual(run({ rateChanges: [{ date: "2026-02-01", rate: "99" }] }), run());
});
test("a variable rate change charges the opening rate and resizes at the due date", () => {
  const s = run({ initialBalance: 120000, annualRate: "12", rateType: "variable", termMonths: 12, rateChanges: [{ date: "2026-02-01", rate: "24" }] });
  assert.equal(s.payments[0].interest, 1200); assert.equal(s.payments[0].accrualRate, "12"); assert.equal(s.payments[0].sizingRate, "24");
  assert.equal(s.payments[1].accrualRate, "24"); assert.equal(s.payments[0].payment, s.payments[1].payment); assert.equal(s.payments.at(-1)!.endingBalance, 0);
});
test("mid-period changes resize on the next due date; future changes do not leak backward", () => {
  const s = run({ rateType: "arm", termMonths: 12, rateChanges: [{ date: "2026-03-15", rate: "5" }] });
  assert.equal(s.payments[1].sizingRate, "3.5"); assert.equal(s.payments[2].sizingRate, "5"); assert.equal(s.payments[2].accrualRate, "3.5"); assert.equal(s.payments[3].accrualRate, "5"); assert.equal(s.reAmortizing, true);
});
test("rate representation and input order do not invent reamortization", () => {
  const changes = [{ date: "2026-03-01", rate: "3.500" }, { date: "2026-02-01", rate: "3.5" }];
  assert.equal(run({ rateType: "variable", rateChanges: changes }).reAmortizing, false); assert.equal(run({ rateType: "variable", rateChanges: changes }).totalPaid, run().totalPaid);
});
test("actual/365 uses calendar days and a single currency rounding", () => {
  const s = run({ initialBalance: 365000, annualRate: "12", dayCount: "actual_365", termMonths: 12 }); assert.equal(s.payments[0].interest, 3720); assert.equal(s.payments.at(-1)!.endingBalance, 0);
});
test("actual/actual splits a cross-year period at each year's own length", () => {
  const s = run({ initialBalance: 365000, annualRate: "12", startDate: "2023-12-15", dayCount: "actual_actual", termMonths: 12 });
  // 17/365 + 14/366 of a 12% year, rounded once to minor units.
  assert.equal(s.payments[0].interest, Math.round(365000 * .12 * (17 / 365 + 14 / 366)));
});
test("insurance is additional, with level and decreasing bases", () => {
  const level = run({ initialBalance: 120000, annualRate: "0", termMonths: 12, insuranceRate: "1.2", insuranceType: "level_term" });
  const decreasing = run({ initialBalance: 120000, annualRate: "0", termMonths: 12, insuranceRate: "1.2" });
  assert.equal(level.totalInsurance, 1440); assert.equal(decreasing.totalInsurance, 780); assert.equal(level.totalPaid, 121440);
  assert.deepEqual(level.payments.map(p => p.principal), decreasing.payments.map(p => p.principal));
});
test("invalid, excessive, duplicate and pre-origination inputs fail", () => {
  for (const patch of [{ annualRate: "100.001" }, { annualRate: "-1" }, { annualRate: "NaN" }, { annualRate: "1.0001" }, { termMonths: 0 }, { termMonths: 1201 }, { initialBalance: 0 }, { insuranceRate: "10000.0001" }, { startDate: "2199-12-31" }, { rateChanges: [{ date: "2026-02-30", rate: "5" }] }, { rateType: "variable", rateChanges: [{ date: "2025-12-01", rate: "5" }] }, { rateChanges: [{ date: "2026-02-01", rate: "5" }, { date: "2026-02-01", rate: "6" }] }]) assert.throws(() => terms(patch));
});
test("totals and intermediate balances cannot overflow the supported range", () => {
  assert.throws(() => run({ initialBalance: 1_000_000_000_000, annualRate: "100" }), /money range/);
});
test("native terms preserve contract principal, nonstandard variable vocabulary and insurance", () => {
  const t = importLoanTerms({ initial_balance: "1000.0050", start_date: "2024-01-31", term_months: 24, interest_rate: "5.125", rate_type: "arm", variable_rate_schedule: { "2024-04-01": "6.000" }, down_payment: "200.005", insurance_rate: "0.2500", insurance_rate_type: "level_term", principal_only_transfers: true, subtype: "mortgage" }, "USD", { principal: 50000, date: "2026-01-01" });
  assert.equal(t.initialBalance, 100001); assert.equal(t.downPayment, 20001); assert.equal(t.principalOnlyTransfers, true); assert.equal(t.rateChanges[0].rate, "6.000"); assert.ok(loanSchedule(t));
});
test("native loan money rounds at zero and three decimal currency boundaries", () => {
  assert.equal(importLoanTerms({ initial_balance: "100.5" }, "JPY", { principal: 1, date: "2026-01-01" }).initialBalance, 101);
  assert.equal(importLoanTerms({ initial_balance: "100.0005" }, "KWD", { principal: 1, date: "2026-01-01" }).initialBalance, 100001);
});
test("native missing principal/date use the tracked fallback, while malformed fields fail", () => {
  const t = importLoanTerms({}, "USD", { principal: 50000, date: "2026-01-01" }); assert.equal(t.initialBalance, 50000); assert.equal(t.startDate, "2026-01-01"); assert.equal(loanSchedule(t), null);
  for (const source of [{ variable_rate_schedule: [] }, { term_months: "twelve" }, { principal_only_transfers: "false" }, { down_payment: "-1" }]) assert.throws(() => importLoanTerms(source, "USD", { principal: 50000, date: "2026-01-01" }));
});
const state = () => ({ ...structuredClone(emptyState), profile: { ownerId: "one", revision: 0, name: "One", currency: "USD" as const }, accounts: [{ id: "loan", ownerId: "one", name: "Loan", type: "loan" as const, currency: "USD" as const, openingBalance: -90000, openingDate: "2026-01-01", archived: 0, loanTerms: terms({ initialBalance: 120000, termMonths: 12 }) }] });
test("contract schedules never change ledger balances or reports", () => {
  const s = state(), before = structuredClone(s); assert.equal(accountBalance(s.accounts[0], s), -90000); loanSchedule(s.accounts[0].loanTerms); assert.deepEqual(s, before); validateWorkspace(s);
});
test("backups preserve loan terms and remap accounts; older backups without terms still load", () => {
  const s = state(), parsed = parseSitesBackup(JSON.stringify({ ...s, format: "sure-sites", version: 19 })).data, mapped = remapWorkspace(parsed);
  assert.deepEqual(mapped.accounts[0].loanTerms, s.accounts[0].loanTerms); assert.notEqual(mapped.accounts[0].id, "loan");
  const legacy = JSON.parse(JSON.stringify(s)); delete legacy.accounts[0].loanTerms; assert.equal(parseSitesBackup(JSON.stringify({ ...legacy, format: "sure-sites", version: 1 })).data.accounts[0].loanTerms, undefined);
  assert.throws(() => validateWorkspace({ ...s, accounts: [{ ...s.accounts[0], type: "checking" }] }), /loan account/);
});
test("native Sure loan import uses original terms without replaying a historical payment", () => {
  const exportText = JSON.stringify({ type: "Account", data: { id: "loan", name: "Mortgage", accountable_type: "Loan", currency: "USD", balance: "900", accountable: { initial_balance: "1200", start_date: "2025-01-01", term_months: 24, interest_rate: "5", rate_type: "fixed" } } });
  const imported = parseSureExport(exportText, { name: "Test", currency: "USD", exportDate: "2026-01-01" });
  assert.equal(imported.data.accounts[0].loanTerms!.initialBalance, 120000); assert.equal(imported.data.accounts[0].loanTerms!.startDate, "2025-01-01"); assert.equal(imported.data.transactions.length, 0); assert.equal(imported.data.valuations.at(-1)!.amount, -90000);
});
