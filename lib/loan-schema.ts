import { z } from "zod";
import { today, validDate } from "./finance.ts";

const amount = z.number().int().min(0).max(1_000_000_000_000);
const rate = (places: number) => z.string().regex(new RegExp(`^(?:0|[1-9]\\d{0,2})(?:\\.\\d{1,${places}})?$`), `Enter an annual percentage with up to ${places} decimal places.`).refine(v => Number(v) <= 100, "The annual percentage must be between 0 and 100.");
const date = z.string().refine(validDate, "Use a valid date between 1900 and 2199.");
export const loanTermsSchema = z.object({
  subtype: z.enum(["mortgage", "student", "auto", "home_equity", "line_of_credit", "business", "other"]).nullable().default(null),
  initialBalance: amount.positive().nullable().default(null),
  startDate: date.refine(v => v <= today(), "Origination cannot be in the future.").nullable().default(null),
  termMonths: z.number().int().min(1).max(1200).nullable().default(null),
  annualRate: rate(3).nullable().default(null),
  rateType: z.string().trim().min(1).max(40).nullable().default(null),
  rateChanges: z.array(z.object({ date, rate: rate(3) }).strict()).max(200).default([]),
  dayCount: z.enum(["thirty_360", "actual_365", "actual_actual"]).default("thirty_360"),
  downPayment: amount.nullable().default(null),
  insuranceRate: z.string().regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,4})?$/, "Enter a nonnegative annual insurance percentage with up to four decimal places.").nullable().default(null),
  insuranceType: z.enum(["level_term", "decreasing_life"]).nullable().default(null),
  principalOnlyTransfers: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  const dates = new Set<string>();
  for (const row of value.rateChanges) {
    if (dates.has(row.date)) ctx.addIssue({ code: "custom", message: "Each rate-change date must be unique." });
    dates.add(row.date);
    if (value.rateType && value.rateType !== "fixed" && value.startDate && row.date < value.startDate) ctx.addIssue({ code: "custom", message: "Rate changes cannot precede origination." });
  }
  if (value.startDate && value.termMonths) {
    const [year, month] = value.startDate.split("-").map(Number);
    if (year * 12 + month - 1 + value.termMonths >= 2200 * 12) ctx.addIssue({ code: "custom", message: "The last payment must be before 2200." });
  }
});

export const loanTermsCommand = z.object({
  action: z.literal("loanTerms"), accountId: z.string().uuid(),
  terms: loanTermsSchema.nullable(), expectedRevision: z.number().int().safe().nonnegative(),
});
