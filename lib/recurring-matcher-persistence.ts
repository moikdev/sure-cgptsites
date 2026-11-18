import type { RecurringMatchRejection } from "./recurring-matcher-types.ts";
export const rejectionColumns = ["id", "owner_id", "recurring_entry_id", "transaction_id", "split_line_id"];
export const rejectionSelect = "id,owner_id AS ownerId,recurring_entry_id AS recurringEntryId,transaction_id AS transactionId,split_line_id AS splitLineId";
export const rejectionValues = (row: RecurringMatchRejection) => [row.id, row.ownerId, row.recurringEntryId, row.transactionId, row.splitLineId];
