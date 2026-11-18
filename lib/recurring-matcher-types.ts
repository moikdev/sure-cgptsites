export interface RecurringMatcherSettings {
  enabled: boolean; daysEarly: number; daysLate: number; amountTolerancePct: string;
  detectedName: string | null; aliases: string[]; learnedTolerancePct: string;
  sourceHints: Record<string, unknown> | null;
}
export interface RecurringMatchRejection {
  id: string; ownerId: string; recurringEntryId: string; transactionId: string;
  splitLineId: string | null;
}
