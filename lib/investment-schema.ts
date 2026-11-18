import {csvAccountMappingsSchema,investmentAccountCreationsSchema} from './investment-import-accounts.ts';
import {tradeExcludedSchema} from './investment-reporting-schema.ts';
import {investmentCSVOptionsSchema} from './investment-csv-mapping.ts';
import {z} from 'zod';
import {CURRENCIES} from './finance.ts';
import {canonicalDecimal,decimalAtoms,QTY_SCALE,PRICE_SCALE} from './decimal.ts';
import {ledgerAmount,ledgerDate,ledgerKey,websiteSchema} from './ledger-schema.ts';
import {rateSchema} from './fx-schema.ts';
import {TRADE_ACTIVITIES} from './investment-types.ts';
const decimal=(places:number,positive=false)=>z.string().max(80).transform((text,ctx)=>{try{const value=canonicalDecimal(text,places);if(positive&&decimalAtoms(value,places)<0n)throw new Error('Use a non-negative value.');return value;}catch(e){ctx.addIssue({code:z.ZodIssueCode.custom,message:(e as Error).message});return z.NEVER;}});
export const quantitySchema=decimal(QTY_SCALE),priceSchema=decimal(PRICE_SCALE,true);
export const securityFields={ticker:z.string().trim().min(1).max(40),name:z.string().trim().min(1).max(160),exchange:z.string().trim().max(40).default(''),kind:z.enum(['standard','cash']).default('standard'),websiteUrl:websiteSchema};
export const priceFields={securityId:ledgerKey,date:ledgerDate,currency:z.enum(CURRENCIES),price:priceSchema};
const ratio=z.string().regex(/^[1-9]\d{0,79}$/);
const quoteFields={date:ledgerDate,fromCurrency:z.enum(CURRENCIES),toCurrency:z.enum(CURRENCIES),rateNumerator:ratio,rateDenominator:ratio,rateDate:ledgerDate.nullable(),rateSource:z.enum(['saved','inverse','manual','imported'])};
export const tradeConversionSchema=z.object({...quoteFields,qty:quantitySchema,sourcePrice:priceSchema,sourceFee:ledgerAmount.refine(n=>n>=0),sourceCashAmount:ledgerAmount,requestFingerprint:z.string().regex(/^[0-9a-f]{64}$/).nullable()}).strict();
export const holdingConversionSchema=z.object({...quoteFields,qty:quantitySchema,sourcePrice:priceSchema,sourceAmount:ledgerAmount,sourceCostBasis:priceSchema.nullable(),costBasisAmount:z.number().int().safe().nullable()}).strict();
export const tradeFields={excluded:tradeExcludedSchema,conversion:tradeConversionSchema.nullable().default(null),accountId:ledgerKey,securityId:ledgerKey,date:ledgerDate,name:z.string().trim().min(1).max(160),qty:quantitySchema,price:priceSchema,fee:ledgerAmount.refine(n=>n>=0),cashAmount:ledgerAmount,currency:z.enum(CURRENCIES),activity:z.enum(TRADE_ACTIVITIES),sequence:z.number().int().safe().nonnegative(),notes:z.string().max(2000).default(''),importKey:z.string().max(256).nullable().default(null)};
export const holdingFields={conversion:holdingConversionSchema.nullable().default(null),accountId:ledgerKey,securityId:ledgerKey,date:ledgerDate,qty:quantitySchema,price:priceSchema,amount:ledgerAmount,currency:z.enum(CURRENCIES),costBasis:priceSchema.nullable(),costBasisSource:z.enum(['manual','provider','calculated']).nullable(),costBasisLocked:z.union([z.literal(0),z.literal(1)]),securityLocked:z.union([z.literal(0),z.literal(1)]).default(0)};
export const splitFields={securityId:ledgerKey,date:ledgerDate,numerator:z.number().int().min(1).max(1000000000),denominator:z.number().int().min(1).max(1000000000)};
export const cashBalanceFields={accountId:ledgerKey,date:ledgerDate,amount:ledgerAmount};
const id=z.string().uuid();
export const investmentCommands=[
 z.object({action:z.literal('investmentImport'),kind:z.enum(['trades','holdings','prices']),accountId:ledgerKey.nullable(),currency:z.enum(CURRENCIES),csv:z.string().min(1).max(1000000),csvOptions:investmentCSVOptionsSchema.optional(),accountMappings:csvAccountMappingsSchema.optional(),accountCreations:investmentAccountCreationsSchema.optional(),requestId:z.string().uuid().optional(),expectedRevision:z.number().int().safe().nonnegative().optional()}).strict(),
 z.object({action:z.literal('security'),id:id.optional(),...securityFields}),z.object({action:z.literal('deleteSecurity'),id}),
 z.object({action:z.literal('securityPrice'),id:id.optional(),...priceFields}),z.object({action:z.literal('deleteSecurityPrice'),id}),
 z.object({action:z.literal('foreignTrade'),id:id.optional(),requestId:id.optional(),...tradeFields,exchangeRate:rateSchema.optional()}),
 z.object({action:z.literal('trade'),id:id.optional(),requestId:id.optional(),...tradeFields}),z.object({action:z.literal('deleteTrade'),id}),
 z.object({action:z.literal('foreignHolding'),id:id.optional(),...holdingFields,exchangeRate:rateSchema.optional(),cashBalance:ledgerAmount.optional()}),
 z.object({action:z.literal('holding'),id:id.optional(),...holdingFields,cashBalance:ledgerAmount.optional()}),z.object({action:z.literal('deleteHolding'),id}),
 z.object({action:z.literal('securitySplit'),id:id.optional(),...splitFields}),z.object({action:z.literal('deleteSecuritySplit'),id}),
 z.object({action:z.literal('investmentCash'),id:id.optional(),...cashBalanceFields}),z.object({action:z.literal('deleteInvestmentCash'),id}),
] as const;
export const investmentCommandSchema=z.discriminatedUnion('action',investmentCommands);
