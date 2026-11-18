import {z} from 'zod';
import {goalConversionSchema} from './goal-fx.ts';
import {CURRENCIES,validDate} from './finance.ts';
const id=z.string().min(1).max(160),commandId=z.string().uuid(),date=z.string().refine(validDate,'Use a valid calendar date.'),amount=z.number().int().safe().min(0),positive=amount.refine(n=>n>0,'Amount must be positive.');
export const goalFields={progressBasis:z.enum(['balance','contributions']).default('balance'),name:z.string().trim().min(1).max(255),currency:z.enum(CURRENCIES),targetAmount:positive,targetDate:date.nullable().default(null),kind:z.enum(['one_off','maintained']).default('one_off'),state:z.enum(['active','paused','completed','archived']).default('active'),targetMode:z.enum(['fixed','months_of_expenses']).default('fixed'),targetMonths:z.number().int().min(1).max(120).nullable().default(null),consumedAmount:amount.default(0),completedAmount:amount.nullable().default(null),completedAt:date.nullable().default(null),color:z.string().regex(/^#[\da-fA-F]{6}$/).default('#14b8a6'),notes:z.string().max(4000).default('')};
export const goalAccountFields={goalId:id,accountId:id,allocatedAmount:amount.nullable()};
export const goalConsumptionFields={conversion:goalConversionSchema.nullable().default(null),goalId:id,accountId:id,transactionId:id.nullable().default(null),amount:positive,date,notes:z.string().max(2000).default('')};
const {state,consumedAmount,completedAmount,completedAt,...editable}=goalFields;
export const goalCommands=[
 z.object({action:z.literal('goal'),id:commandId.optional(),...editable,progressBasis:goalFields.progressBasis.removeDefault().optional(),links:z.array(z.object({accountId:commandId,allocatedAmount:amount.nullable()})).min(1).max(500)}),
 z.object({action:z.literal('goalTransition'),id:commandId,event:z.enum(['pause','resume','complete','archive','unarchive','reopen'])}),
 z.object({action:z.literal('deleteGoal'),id:commandId}),
 z.object({action:z.literal('refreshGoalTarget'),id:commandId}),
 z.object({action:z.literal('consumeGoal'),id:commandId,accountId:commandId,transactionId:commandId.nullable().default(null),amount:positive,date,notes:z.string().max(2000).default('')}),
] as const;
export const goalCommandSchema=z.discriminatedUnion('action',goalCommands);
