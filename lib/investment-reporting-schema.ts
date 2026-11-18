import {z} from 'zod';
export const INVESTMENT_ACTIVITY_LABELS=['Buy','Sell','Sweep In','Sweep Out','Dividend','Reinvestment','Interest','Fee','Transfer','Contribution','Withdrawal','Exchange','Other'] as const;
export type InvestmentActivity=typeof INVESTMENT_ACTIVITY_LABELS[number];
export const investmentActivitySchema=z.enum(INVESTMENT_ACTIVITY_LABELS).nullable().optional();
export const tradeExcludedSchema=z.union([z.literal(0),z.literal(1)]).nullable().optional();
export const investmentReportingCommand=z.object({action:z.literal('investmentReporting'),source:z.enum(['transaction','trade']),id:z.string().uuid(),investmentActivity:investmentActivitySchema,excluded:z.boolean().optional(),expectedRevision:z.number().int().safe().nonnegative()}).strict();
