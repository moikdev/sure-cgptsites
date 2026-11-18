import { z } from "zod";
import { ledgerDate, ledgerKey } from "./ledger-schema.ts";
export function boundedMatcherJSON(value: unknown): boolean {
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 256000) return false;
    const queue = [{ value, depth: 0 }]; let nodes = 0;
    while (queue.length) {
      const { value: v, depth } = queue.pop()!;
      if (++nodes > 20000 || depth > 12) return false;
      if (v === null || typeof v === "boolean" || typeof v === "string") continue;
      if (typeof v === "number") { if (!Number.isFinite(v)) return false; continue; }
      if (typeof v !== "object") return false;
      for (const child of Object.values(v)) queue.push({ value: child, depth: depth + 1 });
    }
    return true;
  } catch { return false; }
}
export const matcherJSON = z.record(z.unknown()).refine(boundedMatcherJSON, "Matcher evidence must be bounded finite JSON.");
const percent = z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/);
export const recurringMatcherSettingsSchema = z.object({
  enabled: z.boolean().default(false), daysEarly: z.number().int().min(0).max(365).default(2), daysLate: z.number().int().min(0).max(365).default(7),
  amountTolerancePct: percent.default("7.5"), detectedName: z.string().trim().min(1).max(160).nullable().default(null),
  aliases: z.array(z.string().trim().min(1).max(160)).max(1000).default([]),
  learnedTolerancePct: percent.refine(v => Number(v) <= 25).default("0"), sourceHints: matcherJSON.nullable().default(null),
}).strict().refine(boundedMatcherJSON,"Matching settings exceed the supported JSON size or depth.");
export const recurringMatchRejectionFields = { recurringEntryId: ledgerKey, transactionId: ledgerKey, splitLineId: ledgerKey.nullable().default(null) };
const id = z.string().uuid(), revision = z.number().int().safe().nonnegative();
export const recurringMatcherCommands = [
  z.object({ action: z.literal("recurringMatcherSettings"), recurringEntryId: id, settings: recurringMatcherSettingsSchema, expectedRevision: revision }),
  z.object({ action: z.literal("recurringMatchReview"), mode: z.enum(["preview", "commit"]), from: ledgerDate, to: ledgerDate, asOf: ledgerDate, writeMode: z.enum(["live", "backfill"]).default("live"), recurringEntryId: id.optional(), offset: z.number().int().min(0).max(20000).default(0), expectedRevision: revision.optional(), receipt: z.string().length(64).optional() }),
  z.object({ action: z.literal("recurringMatchReject"), recurringEntryId: id, transactionId: id, splitLineId: id.nullable().default(null), expectedRevision: revision }),
  z.object({ action: z.literal("deleteRecurringMatchRejection"), id, expectedRevision: revision }),
] as const;
export const recurringMatcherCommandSchema = z.discriminatedUnion("action", recurringMatcherCommands);
