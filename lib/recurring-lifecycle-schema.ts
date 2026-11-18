import {z} from 'zod';
import {ledgerDate} from './ledger-schema.ts';
export const lifecycleDates={renewsOn:ledgerDate.nullable(),trialEndsOn:ledgerDate.nullable(),cancelledOn:ledgerDate.nullable()};
export const lifecycleKeys=['renewsOn','trialEndsOn','cancelledOn'] as const;
const id=z.string().uuid(),expectedRevision=z.number().int().safe().nonnegative();
export const recurringLifecycleCommands=[
 z.object({action:z.literal('recurringLifecycle'),recurringEntryId:id,...lifecycleDates,expectedRevision}),
 z.object({action:z.literal('recurringHistoryRetry'),recurringEntryId:id,expectedRevision}),
 z.object({action:z.literal('recurringStatus'),recurringEntryId:id,event:z.enum(['pause','resume','end']),expectedRevision}),
] as const;
export const recurringLifecycleCommandSchema=z.discriminatedUnion('action',recurringLifecycleCommands);
