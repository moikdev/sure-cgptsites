import {z} from 'zod';
export const loanReplayCommands=[z.object({action:z.literal('loanReplay'),mode:z.enum(['preview','commit']),accountId:z.string().uuid(),enabled:z.boolean(),offset:z.number().int().min(0).max(20000).default(0),expectedRevision:z.number().int().safe().nonnegative().optional(),receipt:z.string().length(64).optional(),reviewedOn:z.string().optional(),confirmation:z.string().optional()}).strict()] as const;
export const loanReplayCommandSchema=z.discriminatedUnion('action',loanReplayCommands);
