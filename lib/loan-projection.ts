import { z } from "zod";
import { accountBalance, moneyInput, today, validDate, type FinanceState } from "./finance.ts";
import { loanSchedule, loanMinor, loanPeriodInterest, loanRateUnits } from "./loans.ts";
import type { LoanTerms } from "./loan-types.ts";
import { toCSV } from "./csv.ts";

export const EXTRA_FREQUENCIES = ["monthly", "weekly", "fortnightly"] as const;
export type ExtraFrequency = typeof EXTRA_FREQUENCIES[number];
const optionsSchema = z.object({
  asOf: z.string().refine(validDate, "Use a valid projection date."),
  extraAmount: z.number().int().min(0).max(1_000_000_000_000).default(0),
  frequency: z.enum(EXTRA_FREQUENCIES).default("monthly"),
});
export type LoanProjectionOptions = z.infer<typeof optionsSchema>;
export interface ProjectedLoanPayment {
  number: number; contractNumber: number; date: string; openingBalance: number;
  contractedPayment: number; extraOccurrences: number; requestedExtra: number;
  appliedExtra: number; payment: number; principal: number; interest: number;
  endingBalance: number; accrualRate: string;
}
export interface LoanProjection {
  status: "projected" | "settled" | "missing_terms" | "matured" | "zero_payment";
  applicable: boolean; converged: boolean; currentPrincipal: number;
  maturity: string | null; payoffDate: string | null; balloonAmount: number;
  totalInterest: number; totalPayments: number; totalExtra: number; totalCost: number | null;
  monthsSavedAgainstContract: number; interestSavedAgainstContract: number;
  payments: ProjectedLoanPayment[];
}

/** Match Sure's monthly projection; hypothetical extras never change records. */
export function loanPayoff(terms: LoanTerms | null | undefined, principal: number, input: LoanProjectionOptions): LoanProjection {
  const options = optionsSchema.parse(input);
  if (!Number.isSafeInteger(principal) || principal < 0 || principal > 1_000_000_000_000) throw new Error("The recorded principal is outside the supported money range.");
  if (terms?.startDate && options.asOf < terms.startDate) throw new Error("Choose a projection date on or after origination.");
  const contract = terms ? loanSchedule(terms) : null;
  const empty: LoanProjection = {
    status: "missing_terms", applicable: false, converged: false, currentPrincipal: principal,
    maturity: contract?.payoffDate ?? null, payoffDate: null, balloonAmount: principal,
    totalInterest: 0, totalPayments: 0, totalExtra: 0, totalCost: null,
    monthsSavedAgainstContract: 0, interestSavedAgainstContract: 0, payments: [],
  };
  if (!principal) return { ...empty, status: "settled", balloonAmount: 0 };
  if (!contract || !terms) return empty;
  const remaining = contract.payments.filter(p => p.date > options.asOf);
  if (!remaining.length) return { ...empty, status: "matured" };
  if (remaining[0].payment <= 0) return { ...empty, status: "zero_payment" };
  const changes = [...terms.rateChanges].sort((a, b) => a.date.localeCompare(b.date));
  const rateOn = (date: string) => terms.rateType === "fixed" ? terms.annualRate! : changes.findLast(row => row.date <= date)?.rate ?? terms.annualRate!;
  const periodStart = contract.payments.findLast(p => p.date <= options.asOf)?.date ?? terms.startDate!;
  const interval = options.frequency === "weekly" ? 7 : options.frequency === "fortnightly" ? 14 : null;
  const extrasThrough = (date: string) => {
    const elapsed = (Date.parse(date) - Date.parse(options.asOf)) / 86400000;
    return elapsed < 1 ? 0 : Math.floor((elapsed - 1) / interval!) + 1;
  };
  let balance = BigInt(principal), totalInterest = 0n, totalPayments = 0n, totalExtra = 0n;
  const payments: ProjectedLoanPayment[] = [];
  for (let i = 0; i < remaining.length && balance > 0n; i++) {
    const row = remaining[i], start = i ? remaining[i - 1].date : periodStart;
    const accrualRate = rateOn(start), charge = loanPeriodInterest(balance, loanRateUnits(accrualRate), start, row.date, terms.dayCount);
    const occurrences = interval ? extrasThrough(row.date) - extrasThrough(i ? remaining[i - 1].date : options.asOf) : 1;
    const requestedExtra = BigInt(options.extraAmount) * BigInt(occurrences);
    const proposed = BigInt(row.payment) + requestedExtra, settlement = balance + charge;
    const paid = proposed >= settlement ? settlement : proposed;
    const principalPaid = paid - charge, ending = balance - principalPaid;
    const appliedExtra = paid > BigInt(row.payment) ? paid - BigInt(row.payment) : 0n;
    payments.push({ number: i + 1, contractNumber: row.number, date: row.date, openingBalance: loanMinor(balance), contractedPayment: row.payment, extraOccurrences: options.extraAmount ? occurrences : 0, requestedExtra: Number(requestedExtra), appliedExtra: loanMinor(appliedExtra), payment: loanMinor(paid), principal: loanMinor(principalPaid), interest: loanMinor(charge), endingBalance: loanMinor(ending), accrualRate });
    totalInterest += charge; totalPayments += paid; totalExtra += appliedExtra; balance = ending;
  }
  const converged = balance === 0n;
  return {
    ...empty, status: "projected", applicable: true, converged, payments,
    payoffDate: converged ? payments.at(-1)!.date : null, balloonAmount: loanMinor(balance),
    totalInterest: loanMinor(totalInterest), totalPayments: loanMinor(totalPayments), totalExtra: loanMinor(totalExtra),
    totalCost: converged ? loanMinor(BigInt(principal) + totalInterest) : null,
    monthsSavedAgainstContract: remaining.length - payments.length,
    interestSavedAgainstContract: loanMinor(remaining.reduce((n, p) => n + BigInt(p.interest), 0n) - totalInterest),
  };
}

export class LoanProjectionError extends Error { status:number; constructor(status: number, message: string) { super(message); this.status=status; } }
export function createLoanProjectionReport(state: FinanceState, accountId: string, input: LoanProjectionOptions, expectedRevision?: number) {
  if (!state.profile) throw new LoanProjectionError(409, "Create your workspace first.");
  const account = state.accounts.find(a => a.id === accountId);
  if (!account) throw new LoanProjectionError(404, "Account not found.");
  if (account.type !== "loan") throw new LoanProjectionError(400, "Choose a loan account.");
  if (expectedRevision !== undefined && expectedRevision !== state.profile.revision) throw new LoanProjectionError(409, "Your workspace changed. Calculate a fresh projection before paging or downloading.");
  const options = optionsSchema.parse(input);
  if (options.asOf > today() || options.asOf < account.openingDate) throw new LoanProjectionError(400, "Choose a recorded date between the account opening and today.");
  const recordedBalance = accountBalance(account, state, options.asOf), principal = Math.max(0, -recordedBalance);
  const baseline = loanPayoff(account.loanTerms, principal, { ...options, extraAmount: 0 });
  const scenario = options.extraAmount > 0 ? loanPayoff(account.loanTerms, principal, options) : null;
  const comparable = scenario?.converged && baseline.converged;
  return {
    accountId, accountName: account.name, currency: account.currency, recordedBalance,
    revision: state.profile.revision, options, baseline, scenario,
    comparison: scenario ? {
      monthsSooner: comparable ? baseline.payments.length - scenario.payments.length : null,
      interestSaved: comparable ? baseline.totalInterest - scenario.totalInterest : null,
      totalCostSaved: comparable ? baseline.totalCost! - scenario.totalCost! : null,
    } : null,
  };
}
export type LoanProjectionReport = ReturnType<typeof createLoanProjectionReport>;
export function loanProjectionPage(report: LoanProjectionReport, offset = 0) {
  const totalRows = Math.max(report.baseline.payments.length, report.scenario?.payments.length ?? 0);
  if (!Number.isInteger(offset) || offset < 0 || offset > 1199 || offset > 0 && offset >= totalRows) throw new LoanProjectionError(400, "Choose an available projection page.");
  const limit = 24;
  const page = (projection: LoanProjection) => ({ ...projection, rowCount: projection.payments.length, payments: projection.payments.slice(offset, offset + limit) });
  return { ...report, baseline: page(report.baseline), scenario: report.scenario ? page(report.scenario) : null, offset, limit, totalRows, nextOffset: offset + limit < totalRows ? offset + limit : null };
}
export type LoanProjectionPage = ReturnType<typeof loanProjectionPage>;
export function loanProjectionCSV(report: LoanProjectionReport) {
  const rows = [
    ["series", "as_of", "currency", "period", "contract_period", "date", "opening_balance", "annual_interest_percent", "contract_payment", "extra_occurrences", "requested_extra", "applied_extra", "payment", "principal", "interest", "ending_balance", "converged", "balloon_at_maturity"],
    ...([['baseline', report.baseline], ['extra', report.scenario]] as const).flatMap(([series, projection]) => projection?.payments.map(p => [series, report.options.asOf, report.currency, p.number, p.contractNumber, p.date, moneyInput(p.openingBalance, report.currency), p.accrualRate, moneyInput(p.contractedPayment, report.currency), p.extraOccurrences, moneyInput(p.requestedExtra, report.currency), moneyInput(p.appliedExtra, report.currency), moneyInput(p.payment, report.currency), moneyInput(p.principal, report.currency), moneyInput(p.interest, report.currency), moneyInput(p.endingBalance, report.currency), projection.converged ? "true" : "false", moneyInput(projection.balloonAmount, report.currency)]) ?? []),
  ];
  return toCSV(rows);
}
