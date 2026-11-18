import {z} from 'zod';
import {CURRENCIES,precision,validDate,type Currency,type FinanceState} from './finance.ts';
import {findRate,convertAtRate,FX_LOOKBACK_DAYS,type FxQuote} from './fx.ts';
import {pow10,safeMinorUnits} from './decimal.ts';
const date=z.string().refine(validDate),positive=z.number().int().safe().positive(),ratio=z.string().regex(/^[1-9]\d{0,79}$/);
export const goalConversionSchema=z.object({nativeCurrency:z.enum(CURRENCIES),goalCurrency:z.enum(CURRENCIES),nativeAmount:positive,goalAmount:positive,date,rateNumerator:ratio,rateDenominator:ratio,rateDate:date.nullable(),rateSource:z.enum(['identity','saved','inverse']),rounding:z.enum(['native_ceiling','goal_half_away'])}).strict();
export type GoalConversion=z.infer<typeof goalConversionSchema>;
export function requireGoalRate(state:FinanceState,from:Currency,to:Currency,date:string){const quote=findRate(state,from,to,date);if(!quote)throw new Error(`Add an eligible ${from} → ${to} exchange rate for ${date} (or the previous five days).`);return quote;}
// Usage is entered in goal units. Round the native release upward, so a
// fractional native minor unit never leaves part of the used money reserved.
export function nativeGoalAmount(amount:number,from:Currency,to:Currency,quote:Pick<FxQuote,'numerator'|'denominator'>,rounding:'ceil'|'floor'='ceil'){
 const n=BigInt(amount)*quote.denominator*pow10(precision(from)),d=quote.numerator*pow10(precision(to));return safeMinorUnits(rounding==='ceil'?(n+d-1n)/d:n/d);
}
export function goalConversion(state:FinanceState,from:Currency,to:Currency,amount:number,date:string,rounding:GoalConversion['rounding']):GoalConversion|null{
 if(from===to)return null;const q=requireGoalRate(state,from,to,date),nativeAmount=rounding==='native_ceiling'?nativeGoalAmount(amount,from,to,q):amount,goalAmount=rounding==='native_ceiling'?amount:convertAtRate(amount,from,to,q);if(nativeAmount<=0||goalAmount<=0)throw new Error('The converted saving rounds to zero.');return {nativeCurrency:from,goalCurrency:to,nativeAmount,goalAmount,date,rateNumerator:String(q.numerator),rateDenominator:String(q.denominator),rateDate:q.source==='identity'?null:q.date,rateSource:q.source,rounding};
}
export function validateGoalConversion(value:GoalConversion,from:Currency,to:Currency,date:string,rounding:GoalConversion['rounding']){
 const c=goalConversionSchema.parse(value);if(c.nativeCurrency!==from||c.goalCurrency!==to||c.date!==date||c.rounding!==rounding)throw new Error('Goal conversion does not match its recorded currencies, date or purpose.');const q={numerator:BigInt(c.rateNumerator),denominator:BigInt(c.rateDenominator)};
 if(from===to){if(q.numerator!==q.denominator||c.rateSource!=='identity'||c.rateDate!==null)throw new Error('Same-currency goal conversions use an identity rate.');}else if(c.rateSource==='identity'||!c.rateDate||c.rateDate>date||Date.parse(date)-Date.parse(c.rateDate)>FX_LOOKBACK_DAYS*86400000)throw new Error('Goal conversion has a missing, future or stale applied rate.');
 if(rounding==='native_ceiling'?nativeGoalAmount(c.goalAmount,from,to,q)!==c.nativeAmount:convertAtRate(c.nativeAmount,from,to,q)!==c.goalAmount)throw new Error('Goal conversion does not match its recorded amounts.');return c;
}
