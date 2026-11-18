import {z} from 'zod';import {recurringTimestamp} from './recurring-observations.ts';
const key=z.string().min(1).max(160),uuid=z.string().uuid();
export const transferRejectionFields={outflowTransactionId:key,inflowTransactionId:key,createdAt:recurringTimestamp.nullable().default(null),updatedAt:recurringTimestamp.nullable().default(null)};
export const transferRejectionCommands=[z.object({action:z.literal('transferRejection'),event:z.enum(['reject','dismiss_hints','clear']),transactionId:uuid.optional(),counterpartId:uuid.optional(),id:uuid.optional(),expectedRevision:z.number().int().safe().nonnegative()}).strict()] as const;
export const transferRejectionSchema=z.discriminatedUnion('action',transferRejectionCommands);
