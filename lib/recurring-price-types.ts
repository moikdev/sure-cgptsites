import type { Currency } from "./finance.ts";
export interface RecurringPriceChange {
  id: string; ownerId: string; recurringEntryId: string; effectiveOn: string;
  previousAmount: number; newAmount: number; currency: Currency;
  source: "detected" | "user"; transactionId: string | null;
}
