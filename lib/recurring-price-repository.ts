import { ApiError, commitMutation, database, readState } from "./repository";
import { recurringPriceCommandSchema } from "./recurring-price-schema";
import { recurringPriceColumns, recurringPriceValues } from "./recurring-price-persistence";
import { detectRecurringPrices } from "./recurring-prices";
import { today } from "./finance";
import type { RecurringPriceChange } from "./recurring-price-types";

export async function executeRecurringPrice(owner: string, input: unknown, revision: number) {
  const parsed = recurringPriceCommandSchema.safeParse(input); if (!parsed.success) return null;
  const c = parsed.data, state = await readState(owner), db = database();
  if (state.profile?.revision !== revision) throw new ApiError(409, "Your workspace changed. Review price history again.");
  const insert = (row: RecurringPriceChange) => db.prepare(`INSERT INTO recurring_price_changes (${recurringPriceColumns.join(",")}) VALUES (${recurringPriceColumns.map(() => "?").join(",")})`).bind(...recurringPriceValues(row));
  if (c.action === "recurringPriceReview") {
    if (c.recurringEntryId && !state.recurringEntries.some(e => e.id === c.recurringEntryId)) throw new ApiError(404, "Recurring schedule not found.");
    const asOf = c.asOf ?? today(); if (asOf > today()) throw new ApiError(400, "Choose a review date on or before today.");
    const candidates = detectRecurringPrices(state, asOf, c.recurringEntryId);
    if (c.offset && c.offset >= candidates.length) throw new ApiError(400, "Choose an available price review page.");
    const bytes = new TextEncoder().encode(JSON.stringify(["recurring-price-review", owner, revision, c.recurringEntryId ?? null, asOf]));
    const receipt = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(v => v.toString(16).padStart(2, "0")).join("");
    const canCommit = state.recurringPriceChanges.length + candidates.length <= 5000;
    if (c.mode === "preview") return { total: candidates.length, offset: c.offset, limit: 50, rows: candidates.slice(c.offset, c.offset + 50), asOf, expectedRevision: revision, receipt, canCommit };
    if (c.expectedRevision !== revision || c.receipt !== receipt) throw new ApiError(409, "Your workspace or review options changed. Preview the price changes again.");
    if (!canCommit) throw new ApiError(409, "Price history is limited to 5,000 records. Export a backup and remove unneeded history first.");
    if (candidates.length) await commitMutation(owner, revision, candidates.map(({ seriesName, material, observations, ...row }) => insert({ ...row, id: crypto.randomUUID(), ownerId: owner })), 10);
    return { message: `Recorded ${candidates.length} observed price change(s). Schedule amounts and ledger records are unchanged.` };
  }
  if (c.expectedRevision !== revision) throw new ApiError(409, "Your workspace changed. Reload price history before saving.");
  if (c.action === "deleteRecurringPrice") {
    if (!state.recurringPriceChanges.some(p => p.id === c.id)) throw new ApiError(404, "Price-history record not found.");
    await commitMutation(owner, revision, [db.prepare("DELETE FROM recurring_price_changes WHERE owner_id=? AND id=?").bind(owner, c.id)], 10);
    return { message: "Price-history record removed. Schedule amounts and payments are unchanged." };
  }
  if (!state.recurringEntries.some(e => e.id === c.recurringEntryId)) throw new ApiError(404, "Recurring schedule not found.");
  if (c.transactionId && !state.transactions.some(t => t.id === c.transactionId)) throw new ApiError(404, "Transaction not found.");
  if (state.recurringPriceChanges.some(p => p.recurringEntryId === c.recurringEntryId && p.effectiveOn === c.effectiveOn)) throw new ApiError(409, "This schedule already has a price-history record on that date.");
  if (state.recurringPriceChanges.length >= 5000) throw new ApiError(409, "Price history is limited to 5,000 records.");
  if (c.previousAmount === c.newAmount) throw new ApiError(400, "Record a different new price.");
  await commitMutation(owner, revision, [insert({ id: crypto.randomUUID(), ownerId: owner, recurringEntryId: c.recurringEntryId, effectiveOn: c.effectiveOn, previousAmount: c.previousAmount, newAmount: c.newAmount, currency: c.currency, transactionId: c.transactionId, source: "user" })], 10);
  return { message: "Price history recorded. Edit the schedule separately if its stated amount should change." };
}
