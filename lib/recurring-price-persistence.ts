import type { RecurringPriceChange } from "./recurring-price-types.ts";
export const recurringPriceColumns = ["id", "owner_id", "recurring_entry_id", "effective_on", "previous_amount", "new_amount", "currency", "source", "transaction_id"];
const properties = ["id", "ownerId", "recurringEntryId", "effectiveOn", "previousAmount", "newAmount", "currency", "source", "transactionId"] as const;
export const recurringPriceSelect = recurringPriceColumns.map((column, index) => `${column} AS ${properties[index]}`).join(",");
export const recurringPriceValues = (value: RecurringPriceChange) => properties.map(key => value[key]);
