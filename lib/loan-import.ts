import { parseMoney, precision, type Currency } from "./finance.ts";
import { loanTermsSchema } from "./loan-schema.ts";

// Loan monetary columns in Sure carry four decimals; schedules round at the
// currency boundary. Do that rounding with decimal digits, never binary floats.
function sourceMoney(value: unknown, currency: Currency): number | null {
  if (value === null || value === undefined || value === "") return null;
  const match = /^(-?)(\d+)(?:\.(\d{1,4}))?$/.exec(String(value));
  if (!match) throw new Error("Invalid loan monetary amount.");
  const places = precision(currency), fraction = match[3] ?? "";
  let minor = BigInt(match[2]) * 10n ** BigInt(places) + BigInt(fraction.slice(0, places).padEnd(places, "0"));
  if (fraction.length > places && Number(fraction[places]) >= 5) minor++;
  const signed = Number(match[1] ? -minor : minor);
  if (!Number.isSafeInteger(signed)) throw new Error("Loan monetary amount exceeds the supported range.");
  return parseMoney(`${match[1]}${minor / 10n ** BigInt(places)}${places ? `.${(minor % 10n ** BigInt(places)).toString().padStart(places, "0")}` : ""}`, currency);
}
const optional = (value: unknown) => value === null || value === undefined || value === "" ? null : String(value);
export function importLoanTerms(source: Record<string, unknown>, currency: Currency, fallback: { principal: number; date: string }) {
  const recorded = sourceMoney(source.initial_balance, currency);
  const schedule = source.variable_rate_schedule ?? {};
  if (!schedule || typeof schedule !== "object" || Array.isArray(schedule)) throw new Error("Invalid variable loan rate schedule.");
  const term = source.term_months === null || source.term_months === undefined || source.term_months === "" ? null : Number(source.term_months);
  const principalOnly = source.principal_only_transfers;
  if (principalOnly !== undefined && principalOnly !== null && typeof principalOnly !== "boolean") throw new Error("Invalid principal-only loan flag.");
  return loanTermsSchema.parse({
    subtype: optional(source.subtype),
    initialBalance: recorded !== null && recorded > 0 ? recorded : fallback.principal > 0 ? fallback.principal : null,
    startDate: optional(source.start_date) ?? fallback.date,
    termMonths: term, annualRate: optional(source.interest_rate), rateType: optional(source.rate_type),
    rateChanges: Object.entries(schedule).map(([date, rate]) => ({ date, rate: String(rate) })),
    dayCount: source.day_count_convention ?? "thirty_360",
    downPayment: sourceMoney(source.down_payment, currency),
    insuranceRate: optional(source.insurance_rate), insuranceType: optional(source.insurance_rate_type),
    principalOnlyTransfers: principalOnly ?? false,
  });
}
