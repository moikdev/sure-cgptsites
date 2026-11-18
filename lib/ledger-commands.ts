import { z } from "zod";
import { ledgerAmount, ledgerColor, ledgerDate, recurringFields, splitFields, tagIdsSchema, websiteSchema } from "./ledger-schema.ts";
const id = z.string().uuid(), name = z.string().trim().min(1).max(160);
export const ledgerCommands = [
  z.object({ action: z.literal("tag"), id: id.optional(), name: name.max(80), color: ledgerColor }),
  z.object({ action: z.literal("deleteTag"), id }),
  z.object({ action: z.literal("merchant"), id: id.optional(), name, color: ledgerColor, websiteUrl: websiteSchema }),
  z.object({ action: z.literal("deleteMerchant"), id }),
  z.object({ action: z.literal("setSplit"), id, amount: ledgerAmount, lines: z.array(z.object(splitFields)).min(2).max(100) }),
  z.object({ action: z.literal("clearSplit"), id }),
  z.object({ action: z.literal("transactionMetadata"), id, merchantId: id.nullable(), tagIds: tagIdsSchema }),
  z.object({ action: z.literal("recurring"), id: id.optional(), ...recurringFields }),
  z.object({ action: z.literal("deleteRecurring"), id }),
  z.object({ action: z.literal("occurrence"), recurringEntryId: id, originalDueOn: ledgerDate, operation: z.enum(["skip", "miss", "reopen", "snooze", "edit"]), snoozedUntil: ledgerDate.nullable().optional(), dueOn: ledgerDate.optional(), expectedAmount: ledgerAmount.refine(n => n >= 0).nullable().optional(), notes: z.string().max(2000).optional() }),
  z.object({ action: z.literal("payOccurrence"), recurringEntryId: id, originalDueOn: ledgerDate, requestId: id, mode: z.enum(["new", "link", "record"]), transactionId: id.nullable().default(null), splitLineId:id.nullable().default(null),accountId:id.nullable().default(null),sourceAmount:ledgerAmount.refine(n=>n>0).optional(), amount: ledgerAmount.refine(n => n > 0), paidOn: ledgerDate }),
  z.object({ action: z.literal("deleteAllocation"), id,expectedRevision:z.number().int().safe().nonnegative().optional() }),
  z.object({ action: z.literal("confirmAllocation"), id,sourceAmount:ledgerAmount.refine(n=>n>0).optional() }),
] as const;
export const ledgerCommandSchema = z.discriminatedUnion("action", ledgerCommands);
