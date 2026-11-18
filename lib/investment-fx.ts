import {precision,validDate,type Currency,type FinanceState} from './finance.ts';
import {canonicalRate,convertAtRate,findRate,FX_LOOKBACK_DAYS,type FxQuote} from './fx.ts';
import {canonicalDecimal,decimalAtoms,decimalString,pow10,roundDivide,PRICE_SCALE,QTY_SCALE,quantityValue} from './decimal.ts';
import {validateBaseTrade} from './investment-trade.ts';
import type {Trade,HoldingSnapshot,InvestmentQuote,TradeConversion,HoldingConversion} from './investment-types.ts';
const MAX=1_000_000_000_000;
function quoteRate(c:InvestmentQuote){
 if(!validDate(c.date)||c.fromCurrency===c.toCurrency||!/^\d{1,80}$/.test(c.rateNumerator)||!/^\d{1,80}$/.test(c.rateDenominator))throw new Error('Invalid investment conversion quote.');
 const q={numerator:BigInt(c.rateNumerator),denominator:BigInt(c.rateDenominator)};
 if(q.numerator<=0n||q.denominator<=0n)throw new Error('Investment exchange rates must be positive.');
 if(['saved','inverse'].includes(c.rateSource)){if(!c.rateDate||!validDate(c.rateDate)||c.rateDate>c.date||Date.parse(c.date)-Date.parse(c.rateDate)>FX_LOOKBACK_DAYS*86400000)throw new Error('The investment quote is missing, future or stale.');}
 else if(!['manual','imported'].includes(c.rateSource)||c.rateDate!==null)throw new Error('Invalid manual investment quote.');
 return q;
}
export function convertUnitPrice(price:string,q:Pick<FxQuote,'numerator'|'denominator'>){if(decimalAtoms(price,PRICE_SCALE)<0n)throw new Error('Quoted prices and cost basis cannot be negative.');return canonicalDecimal(decimalString(roundDivide(decimalAtoms(price,PRICE_SCALE)*q.numerator,q.denominator),PRICE_SCALE),PRICE_SCALE);}
function resolveQuote(state:Pick<FinanceState,'exchangeRates'>,fromCurrency:Currency,toCurrency:Currency,date:string,manualRate?:string):InvestmentQuote{
 if(fromCurrency===toCurrency)throw new Error('Use the ordinary investment form for an account-currency entry.');
 const q=manualRate?{numerator:decimalAtoms(canonicalRate(manualRate),18),denominator:pow10(18),date:null,source:'manual' as const}:findRate(state,fromCurrency,toCurrency,date);
 if(!q)throw new Error(`Add an eligible ${fromCurrency} → ${toCurrency} rate for ${date}, or enter the actual exchange rate.`);
 return {date,fromCurrency,toCurrency,rateNumerator:String(q.numerator),rateDenominator:String(q.denominator),rateDate:q.date,rateSource:q.source as InvestmentQuote['rateSource']};
}
function sameQuote(c:InvestmentQuote,from:Currency,to:Currency,date:string){return c.fromCurrency===from&&c.toCurrency===to&&c.date===date;}
type TradeInput=Pick<Trade,'qty'|'price'|'fee'|'cashAmount'|'currency'|'activity'|'date'>;
export function convertForeignTrade(state:Pick<FinanceState,'exchangeRates'>,input:TradeInput,currency:Currency,manualRate?:string,previous?:TradeConversion|null){
 validateBaseTrade(input);
 const retain=previous&&!manualRate&&sameQuote(previous,input.currency,currency,input.date)&&previous.qty===input.qty&&previous.sourcePrice===input.price&&previous.sourceFee===input.fee&&previous.sourceCashAmount===input.cashAmount;
 const c:TradeConversion={...(retain?previous:resolveQuote(state,input.currency,currency,input.date,manualRate)),qty:input.qty,sourcePrice:input.price,sourceFee:input.fee,sourceCashAmount:input.cashAmount,requestFingerprint:null},q=quoteRate(c);
 const row={...input,currency,price:convertUnitPrice(input.price,q),fee:convertAtRate(input.fee,input.currency,currency,q,MAX),cashAmount:convertAtRate(input.cashAmount,input.currency,currency,q,MAX),conversion:c};
 validateTradeConversion(row);return row;
}
export function validateTradeConversion(t:Pick<Trade,'qty'|'price'|'fee'|'cashAmount'|'currency'|'activity'|'conversion'>&{date?:string}){
 const c=t.conversion;if(!c)throw new Error('An investment conversion snapshot is required.');const q=quoteRate(c);
 if(t.date!==undefined&&t.date!==c.date||t.currency!==c.toCurrency||t.qty!==c.qty)throw new Error('The investment quote no longer matches its trade.');
 validateBaseTrade({...t,price:c.sourcePrice,fee:c.sourceFee,cashAmount:c.sourceCashAmount,currency:c.fromCurrency});
 if(!Number.isSafeInteger(c.sourceFee)||c.sourceFee<0||c.sourceFee>MAX||!Number.isSafeInteger(c.sourceCashAmount)||Math.abs(c.sourceCashAmount)>MAX||c.requestFingerprint!==null&&!/^[0-9a-f]{64}$/.test(c.requestFingerprint))throw new Error('Invalid original investment amounts or retry identity.');
 if(t.price!==convertUnitPrice(c.sourcePrice,q)||t.fee!==convertAtRate(c.sourceFee,c.fromCurrency,t.currency,q,MAX)||t.cashAmount!==convertAtRate(c.sourceCashAmount,c.fromCurrency,t.currency,q,MAX))throw new Error('The trade does not match its original amounts and applied conversion.');
}
type HoldingInput=Pick<HoldingSnapshot,'qty'|'price'|'amount'|'currency'|'date'|'costBasis'>;
export function convertForeignHolding(state:Pick<FinanceState,'exchangeRates'>,input:HoldingInput,currency:Currency,manualRate?:string,previous?:HoldingConversion|null,observedValue=false){
 const calculated=quantityValue(input.qty,input.price,precision(input.currency)),sameObservation=previous&&previous.qty===input.qty&&previous.sourcePrice===input.price&&previous.fromCurrency===input.currency,retainedObservation=sameObservation&&previous.sourceAmount===input.amount;
 if(sameObservation&&previous.sourceAmount!==calculated&&input.amount!==previous.sourceAmount)throw new Error('Keep the reported original holding total when editing unchanged quoted shares and price. Reload this holding before editing it.');
 if(!observedValue&&!retainedObservation&&input.amount!==calculated)throw new Error('The original holding value must equal its quantity and quoted unit price.');
 const retain=previous&&!manualRate&&sameQuote(previous,input.currency,currency,input.date)&&previous.qty===input.qty&&previous.sourcePrice===input.price&&previous.sourceAmount===input.amount&&previous.sourceCostBasis===input.costBasis;
 const base=retain?previous:resolveQuote(state,input.currency,currency,input.date,manualRate),q=quoteRate(base),costBasisAmount=input.costBasis===null?null:convertAtRate(quantityValue(input.qty,input.costBasis,precision(input.currency)),input.currency,currency,q);
 const c:HoldingConversion={...base,qty:input.qty,sourcePrice:input.price,sourceAmount:input.amount,sourceCostBasis:input.costBasis,costBasisAmount};
 const row={...input,currency,price:convertUnitPrice(input.price,q),amount:convertAtRate(input.amount,input.currency,currency,q,MAX),costBasis:input.costBasis===null?null:convertUnitPrice(input.costBasis,q),conversion:c};
 validateHoldingConversion(row);return row;
}
export function validateHoldingConversion(h:HoldingInput&{conversion?:HoldingConversion|null}){
 const c=h.conversion;if(!c)throw new Error('A holding conversion snapshot is required.');const q=quoteRate(c);
 if(h.date!==c.date||h.currency!==c.toCurrency||h.qty!==c.qty||Math.sign(c.sourceAmount)!==Math.sign(Number(decimalAtoms(c.qty,QTY_SCALE)))&&c.sourceAmount!==0||!Number.isSafeInteger(c.sourceAmount)||Math.abs(c.sourceAmount)>MAX)throw new Error('The holding quote no longer matches its original observation.');
 if(h.price!==convertUnitPrice(c.sourcePrice,q)||h.amount!==convertAtRate(c.sourceAmount,c.fromCurrency,h.currency,q,MAX)||h.costBasis!==(c.sourceCostBasis===null?null:convertUnitPrice(c.sourceCostBasis,q))||c.costBasisAmount!==(c.sourceCostBasis===null?null:convertAtRate(quantityValue(c.qty,c.sourceCostBasis,precision(c.fromCurrency)),c.fromCurrency,h.currency,q)))throw new Error('The holding does not match its original amounts and applied conversion.');
 if(c.sourceCostBasis!==null&&decimalAtoms(c.sourceCostBasis,PRICE_SCALE)<0n)throw new Error('The original cost basis cannot be negative.');
}
