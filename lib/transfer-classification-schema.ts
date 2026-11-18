import {z} from 'zod';
export const transferClassificationCommands=[z.object({action:z.literal('transferContribution'),mode:z.enum(['preview','commit']),transferId:z.string().uuid(),enabled:z.boolean(),offset:z.number().int().min(0).max(20000).default(0),expectedRevision:z.number().int().safe().nonnegative().optional(),receipt:z.string().regex(/^[a-f0-9]{64}$/).optional(),reviewedOn:z.string().optional()}).strict()] as const;
export const transferClassificationSchema=z.discriminatedUnion('action',transferClassificationCommands);
