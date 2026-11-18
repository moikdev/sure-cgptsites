import {z} from 'zod';import {ledgerDate} from './ledger-schema.ts';
export const recurringDetectionCommands=[z.object({action:z.literal('recurringDetection'),mode:z.enum(['preview','commit']),kind:z.enum(['automatic','bills','income']).default('automatic'),asOf:ledgerDate,offset:z.number().int().min(0).max(20000).default(0),expectedRevision:z.number().int().safe().nonnegative().optional(),receipt:z.string().length(64).optional()}).strict()] as const;
export const recurringDetectionCommandSchema=z.discriminatedUnion('action',recurringDetectionCommands);
