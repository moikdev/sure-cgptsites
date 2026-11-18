import {z} from 'zod';
const id=z.string().uuid(),expectedRevision=z.number().int().safe().nonnegative();
export const paycheckCommands=[
 z.object({action:z.literal('declareRecurringIncome'),recurringEntryId:id,expectedRevision}),
 z.object({action:z.literal('paycheckCashAccount'),accountId:id,excluded:z.boolean(),expectedRevision}),
] as const;
export const paycheckCommandSchema=z.discriminatedUnion('action',paycheckCommands);
