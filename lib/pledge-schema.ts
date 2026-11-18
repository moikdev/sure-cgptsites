import {z} from 'zod';import {CURRENCIES,validDate} from './finance.ts';
import {goalConversionSchema} from './goal-fx.ts';
const id=z.string().min(1).max(160),uuid=z.string().uuid(),timestamp=z.string().datetime().transform(v=>new Date(v).toISOString()),date=z.string().refine(validDate),money=z.number().int().safe().min(-1_000_000_000_000).max(1_000_000_000_000),positive=money.refine(n=>n>0,'Amount must be positive.');
export const pledgeFields={matchedConversion:goalConversionSchema.nullable().default(null),goalId:id,accountId:id,amount:positive,currency:z.enum(CURRENCIES),kind:z.enum(['transfer','manual_save']),status:z.enum(['open','matched','cancelled','expired']),createdAt:timestamp,expiresAt:timestamp,updatedAt:timestamp,matchedEventId:id.nullable().default(null),matchedTransactionId:id.nullable().default(null),matchedValuationId:id.nullable().default(null),matchedDate:date.nullable().default(null),matchedAmount:z.number().int().safe().min(1).max(2_000_000_000_000).nullable().default(null),matchedAt:timestamp.nullable().default(null),matchedSourceName:z.string().max(160).nullable().default(null),matchedPriorBalance:z.number().int().safe().nullable().default(null),matchedNewBalance:z.number().int().safe().nullable().default(null)};
export const pledgeCommands=[
 z.object({action:z.literal('goalPledge'),goalId:uuid,accountId:uuid,amount:positive,kind:z.enum(['transfer','manual_save'])}),
 z.object({action:z.literal('goalPledgeTransition'),id:uuid,event:z.enum(['extend','cancel'])}),
 z.object({action:z.literal('checkGoalPledges'),goalId:uuid.optional(),pledgeId:uuid.optional(),expectedRevision:z.number().int().safe().nonnegative().optional(),receipt:z.string().length(64).optional(),mode:z.enum(['preview','commit']).default('preview')}),
] as const;
export const pledgeCommandSchema=z.discriminatedUnion('action',pledgeCommands);
