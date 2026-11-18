import { loanTermsSchema } from "./loan-schema.ts";
import type { LoanPayment, LoanTerms } from "./loan-types.ts";

const MAX = 1_000_000_000_000n;
const MONTHLY_DENOMINATOR = 1_200_000n;
const round = (n: bigint, d: bigint) => (n * 2n + d) / (d * 2n);
function minor(value: bigint) {
  if (value < -MAX || value > MAX) throw new Error("The loan schedule exceeds the supported money range.");
  return Number(value);
}
function rateUnits(rate: string, places = 3) {
  const [whole, fraction = ""] = rate.split(".");
  return BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0"));
}
export function loanPaymentDate(start: string, number: number) {
  const [year, month, day] = start.split("-").map(Number);
  const index = year * 12 + month - 1 + number, y = Math.floor(index / 12), m = index % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y.toString().padStart(4, "0")}-${(m + 1).toString().padStart(2, "0")}-${Math.min(day, last).toString().padStart(2, "0")}`;
}
const days = (start: string, end: string) => BigInt((Date.parse(end) - Date.parse(start)) / 86400000);
function interest(balance: bigint, rate: bigint, start: string, end: string, dayCount: LoanTerms["dayCount"]) {
  if (dayCount === "thirty_360") return round(balance * rate, MONTHLY_DENOMINATOR);
  if (dayCount === "actual_365") return round(balance * rate * days(start, end), 100_000n * 365n);
  let cursor = start, n = 0n, d = 1n;
  while (cursor < end) {
    const y = Number(cursor.slice(0, 4)), next = `${y + 1}-01-01`, stop = next < end ? next : end;
    const yearDays = days(`${y}-01-01`, next);
    n = n * yearDays + days(cursor, stop) * d;
    d *= yearDays;
    cursor = stop;
  }
  return round(balance * rate * n, 100_000n * d);
}
function levelPayment(balance: bigint, rate: bigint, remaining: number, firstInterest?: bigint) {
  const D = MONTHLY_DENOMINATOR;
  if (firstInterest !== undefined) {
    const later = remaining - 1;
    if (!later) return balance + firstInterest;
    if (!rate) return round(balance + firstInterest, BigInt(remaining));
    const growth = (D + rate) ** BigInt(later), baseline = D ** BigInt(later);
    return round((balance + firstInterest) * rate * growth, rate * growth + D * (growth - baseline));
  }
  if (!rate) return round(balance, BigInt(remaining));
  const growth = (D + rate) ** BigInt(remaining), baseline = D ** BigInt(remaining);
  return round(balance * rate * growth, D * (growth - baseline));
}

/** Contractual monthly schedule; does not replay ledger entries or create payments. */
export function loanSchedule(input: LoanTerms) {
  const terms = loanTermsSchema.parse(input);
  if (terms.initialBalance === null || !terms.startDate || !terms.termMonths || terms.annualRate === null || !terms.rateType) return null;
  const changes = [...terms.rateChanges].sort((a, b) => a.date.localeCompare(b.date));
  const rateOn = (date: string) => terms.rateType === "fixed" ? terms.annualRate! : changes.findLast(row => row.date <= date)?.rate ?? terms.annualRate!;
  let balance = BigInt(terms.initialBalance), payment: bigint | null = null, previousRate: bigint | null = null;
  const payments: LoanPayment[] = [];
  let totalInterest = 0n, totalInsurance = 0n, totalPaid = 0n;
  for (let i = 0; i < terms.termMonths && balance > 0; i++) {
    const start = loanPaymentDate(terms.startDate, i), date = loanPaymentDate(terms.startDate, i + 1);
    const accrualRate = rateOn(start), sizingRate = rateOn(date), accrualUnits = rateUnits(accrualRate), sizingUnits = rateUnits(sizingRate);
    const charge = interest(balance, accrualUnits, start, date, terms.dayCount);
    if (payment === null || previousRate !== sizingUnits) payment = levelPayment(balance, sizingUnits, terms.termMonths - i, sizingUnits !== accrualUnits ? charge : undefined);
    previousRate = sizingUnits;
    const final = i === terms.termMonths - 1 || payment >= balance + charge;
    const principal = final ? balance : payment - charge;
    const paid = final ? balance + charge : payment;
    const premium = terms.insuranceRate ? round((terms.insuranceType === "level_term" ? BigInt(terms.initialBalance) : balance) * rateUnits(terms.insuranceRate, 4), 12_000_000n) : 0n;
    const ending = balance - principal;
    payments.push({ number: i + 1, date, openingBalance: minor(balance), payment: minor(paid), principal: minor(principal), interest: minor(charge), endingBalance: minor(ending), insurance: minor(premium), total: minor(paid + premium), accrualRate, sizingRate });
    totalInterest += charge; totalInsurance += premium; totalPaid += paid + premium; balance = ending;
  }
  return { payments, totalInterest: minor(totalInterest), totalInsurance: minor(totalInsurance), totalPaid: minor(totalPaid), payoffDate: payments.at(-1)?.date ?? null, reAmortizing: payments.some((p, i) => i > 0 && rateUnits(p.sizingRate) !== rateUnits(payments[i - 1].sizingRate)) };
}

export { minor as loanMinor, rateUnits as loanRateUnits, interest as loanPeriodInterest };
