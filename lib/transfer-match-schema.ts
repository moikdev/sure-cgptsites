import {z} from 'zod';
export const transferMatchCommands=[z.object({action:z.literal('transferMatch'),mode:z.enum(['preview','commit']),operation:z.enum(['link','unlink']),transactionId:z.string().uuid(),counterpartId:z.string().uuid().optional(),expectedRevision:z.number().int().safe().nonnegative().optional(),receipt:z.string().regex(/^[a-f0-9]{64}$/).optional(),reviewedOn:z.string().optional()}).strict()] as const;
export const transferMatchSchema=z.discriminatedUnion('action',transferMatchCommands);
