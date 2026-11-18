import {z} from 'zod';
import {categoryIconSchema} from './category-schema.ts';
import {CURRENCIES} from './finance.ts';
import {ledgerKey,ledgerAmount,ledgerDate} from './ledger-schema.ts';
const id=z.string().uuid(),name=z.string().trim().min(1).max(160),currency=z.enum(CURRENCIES),money=z.number().int().safe().nonnegative(),binary=z.union([z.literal(0),z.literal(1)]);
export const budgetBookFields={name,currency,startDay:z.number().int().min(1).max(28).default(1),accountMode:z.enum(['all','selected']).default('all'),accountIds:z.array(ledgerKey).max(500).refine(a=>new Set(a).size===a.length,'Accounts must be unique.').default([]),sourceKind:z.enum(['household','personal','custom']).default('custom'),sourceReference:z.string().max(160).nullable().default(null),legacyCompat:binary.default(0)};
export const budgetPeriodFields={bookId:ledgerKey,startDate:ledgerDate,endDate:ledgerDate,currency,budgetedSpending:money.nullable(),expectedIncome:money.nullable(),autoTotal:binary.default(0)};
export const budgetEnvelopeFields={periodId:ledgerKey,categoryId:ledgerKey,allocated:money,rolloverEnabled:binary.default(0),importedCarry:money.nullable().default(null)};
export const budgetCommands=[
 z.object({action:z.literal('budgetBook'),id:id.optional(),...budgetBookFields}),z.object({action:z.literal('deleteBudgetBook'),id}),
 z.object({action:z.literal('budgetPeriod'),id:id.optional(),...budgetPeriodFields}),z.object({action:z.literal('deleteBudgetPeriod'),id}),
 z.object({action:z.literal('budgetEnvelope'),periodId:id,categoryId:id,allocated:money,rolloverEnabled:z.boolean().optional(),importedCarry:money.nullable().optional()}),
 z.object({action:z.literal('moveBudgetAllocation'),periodId:id,fromCategoryId:id,toCategoryId:id,amount:money.refine(n=>n>0)}),
 z.object({action:z.literal('copyBudgetPeriod'),id,sourceId:id.optional()}),
 z.object({action:z.literal('budget'),categoryId:id,month:z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/),currency,amount:ledgerAmount.refine(n=>n>0)}),z.object({action:z.literal('deleteBudget'),id}),
] as const;
export const budgetCategoryCommands=[z.object({action:z.literal('category'),lucideIcon:categoryIconSchema.optional(),id:id.optional(),name:name.max(80),color:z.string().regex(/^#[\da-fA-F]{6}$/),parentId:id.nullable().default(null)}),z.object({action:z.literal('deleteCategory'),id})] as const;
export const budgetCommandSchema=z.discriminatedUnion('action',[...budgetCommands,...budgetCategoryCommands]);
