import {z} from 'zod';import {validDate} from './finance.ts';
export const contributionBalanceFields={accountId:z.string().min(1).max(160),date:z.string().refine(validDate,'Choose a valid calendar date.'),amount:z.number().int().safe(),source:z.enum(['manual','sure_balance']).default('manual'),notes:z.string().max(2000).default('')};
const id=z.string().uuid();
export const contributionCommands=[z.object({action:z.literal('contributionBalance'),id:id.optional(),accountId:id,date:contributionBalanceFields.date,amount:contributionBalanceFields.amount,notes:contributionBalanceFields.notes}),z.object({action:z.literal('deleteContributionBalance'),id})] as const;
export const contributionCommandSchema=z.discriminatedUnion('action',contributionCommands);
