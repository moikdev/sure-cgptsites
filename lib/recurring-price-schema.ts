import { z } from "zod";
import { CURRENCIES } from "./finance.ts";
import { ledgerAmount, ledgerDate, ledgerKey } from "./ledger-schema.ts";
const positive = ledgerAmount.refine(n => n >= 0, "Prices cannot be negative.");
export const recurringPriceFields = {
  recurringEntryId: ledgerKey, effectiveOn: ledgerDate,
  previousAmount: positive, newAmount: positive, currency: z.enum(CURRENCIES),
  source: z.enum(["detected", "user"]), transactionId: ledgerKey.nullable().default(null),
};
const id = z.string().uuid(), revision = z.number().int().safe().nonnegative();
export const recurringPriceCommands = [
  z.object({ action: z.literal("recurringPriceReview"), mode: z.enum(["preview", "commit"]), recurringEntryId: id.optional(), asOf: ledgerDate.optional(), offset: z.number().int().min(0).max(500).default(0), expectedRevision: revision.optional(), receipt: z.string().length(64).optional() }),
  z.object({ action: z.literal("recurringPriceRecord"), recurringEntryId: id, effectiveOn: ledgerDate, previousAmount: positive, newAmount: positive, currency: z.enum(CURRENCIES), transactionId: id.nullable().default(null), expectedRevision: revision }),
  z.object({ action: z.literal("deleteRecurringPrice"), id, expectedRevision: revision }),
] as const;
export const recurringPriceCommandSchema = z.discriminatedUnion("action", recurringPriceCommands);
