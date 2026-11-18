import {precision,type Account,type Currency,type FinanceState} from './finance.ts';
import {findRate} from './fx.ts';
import {decimalAtoms,decimalString,pow10,roundDivide,safeMinorUnits,PRICE_SCALE,QTY_SCALE} from './decimal.ts';
import type {SecurityPrice,Trade,HoldingSnapshot} from './investment-types.ts';
export interface MarketConversion {sourceId:string;sourceCurrency:Currency;sourcePrice:string;priceDate:string;rateDate:string|null;rateSource:'saved'|'inverse'|'zero';rateNumerator:string|null;rateDenominator:string|null;}
export interface PositionQuote {date:string;priority:number;sequence:number;price:string;currency:Currency;sourceId?:string;holding?:HoldingSnapshot;}
export function selectPositionQuote(state:Pick<FinanceState,'securityPrices'|'profile'>,account:Account,securityId:string,asOf:string,trades:Trade[],holdings:HoldingSnapshot[]):PositionQuote|undefined{
 const quotes:PositionQuote[]=[...state.securityPrices.filter(p=>p.securityId===securityId&&p.date<=asOf&&(p.currency===account.currency||state.profile?.marketFx===1)).map(p=>({date:p.date,priority:3,sequence:0,price:p.price,currency:p.currency,sourceId:p.id})),...holdings.map(h=>({date:h.date,priority:2,sequence:0,price:h.price,currency:account.currency,holding:h})),...trades.filter(t=>decimalAtoms(t.qty,QTY_SCALE)!==0n).map(t=>({date:t.date,priority:1,sequence:t.sequence,price:t.price,currency:account.currency}))];
 return quotes.sort((a,b)=>b.date.localeCompare(a.date)||b.priority-a.priority||(a.currency===account.currency?0:1)-(b.currency===account.currency?0:1)||a.currency.localeCompare(b.currency)||b.sequence-a.sequence)[0];
}
export function foreignMarketPrice(state:Pick<FinanceState,'exchangeRates'>,p:{id:string;price:string;currency:Currency;date:string},currency:Currency){
 const atoms=decimalAtoms(p.price,PRICE_SCALE);if(atoms<0n)throw new Error('Market prices cannot be negative.');
 const q=atoms===0n?null:findRate(state,p.currency,currency,p.date);if(atoms!==0n&&!q)throw new Error(`Add an eligible ${p.currency} → ${currency} rate for the price dated ${p.date}.`);
 const numerator=q?.numerator??1n,denominator=q?.denominator??1n;
 return {numerator:atoms*numerator,denominator,display:decimalString(roundDivide(atoms*numerator,denominator),PRICE_SCALE),conversion:{sourceId:p.id,sourceCurrency:p.currency,sourcePrice:p.price,priceDate:p.date,rateDate:q?.date??null,rateSource:q?.source??'zero',rateNumerator:q?String(q.numerator):null,rateDenominator:q?String(q.denominator):null} as MarketConversion};
}
export interface MarketIssue {accountId:string;accountName:string;securityId:string;ticker:string;priceId:string;date:string;fromCurrency:Currency;toCurrency:Currency;error:string;}
export interface MarketReview {points:number;zeroPoints:number;issueCount:number;issues:MarketIssue[];bounds:Map<string,bigint>;affected:Map<string,string>;}
type MarketPoint={account:Account;securityId:string;price:SecurityPrice;qty:bigint};
// Replay quantities once per account/security. Price conversion never changes
// cash, quantities, acquired basis or disposal evidence.
function visitMarketPoints(state:FinanceState,visit:(point:MarketPoint)=>void){
 const accounts=new Map(state.accounts.filter(a=>['investment','crypto'].includes(a.type)).map(a=>[a.id,a])),groups=new Map<string,{account:Account;securityId:string;events:{date:string;rank:number;sequence:number;id:string;qty?:bigint;numerator?:number;denominator?:number}[]}>(),prices=new Map<string,Map<string,SecurityPrice[]>>();
 for(const p of state.securityPrices){const byDate=prices.get(p.securityId)??new Map<string,SecurityPrice[]>();byDate.set(p.date,[...(byDate.get(p.date)??[]),p]);prices.set(p.securityId,byDate);}
 for(const [rows,rank] of [[state.trades,1],[state.holdingSnapshots,2]] as const)for(const row of rows){const account=accounts.get(row.accountId);if(!account||row.date<account.openingDate)continue;const key=JSON.stringify([account.id,row.securityId]),group=groups.get(key)??{account,securityId:row.securityId,events:[]};group.events.push({date:row.date,rank,sequence:'sequence' in row?row.sequence:0,id:row.id,qty:decimalAtoms(row.qty,QTY_SCALE)});groups.set(key,group);}
 for(const group of groups.values()){
  const {account,securityId,events}=group;for(const split of state.securitySplits.filter(s=>s.securityId===securityId&&s.date>=account.openingDate))events.push({date:split.date,rank:0,sequence:0,id:split.id,numerator:split.numerator,denominator:split.denominator});
  events.sort((a,b)=>a.date.localeCompare(b.date)||a.rank-b.rank||a.sequence-b.sequence||a.id.localeCompare(b.id));let qty=0n,index=0;
  for(const [date,points] of [...(prices.get(securityId)??[])].sort((a,b)=>a[0].localeCompare(b[0]))){while(index<events.length&&events[index].date<=date){const e=events[index++];qty=e.rank===0?roundDivide(qty*BigInt(e.numerator!),BigInt(e.denominator!)):e.rank===2?e.qty!:qty+e.qty!;}if(!qty)continue;const p=[...points].sort((a,b)=>(a.currency===account.currency?0:1)-(b.currency===account.currency?0:1)||a.currency.localeCompare(b.currency))[0];if(p.currency!==account.currency)visit({account,securityId,price:p,qty});}
 }
}
const reviews=new WeakMap<FinanceState,MarketReview>();
export function reviewMarketPrices(state:FinanceState):MarketReview{
 const found=reviews.get(state);if(found)return found;const review:MarketReview={points:0,zeroPoints:0,issueCount:0,issues:[],bounds:new Map(),affected:new Map()},tickers=new Map(state.securities.map(s=>[s.id,s.ticker]));
 visitMarketPoints(state,({account,securityId,price,qty})=>{review.points++;const first=review.affected.get(account.id);if(!first||price.date<first)review.affected.set(account.id,price.date);try{const converted=foreignMarketPrice(state,price,account.currency);if(converted.conversion.rateSource==='zero')review.zeroPoints++;safeMinorUnits(roundDivide(qty*converted.numerator,converted.denominator*pow10(QTY_SCALE+PRICE_SCALE-precision(account.currency))));const ceil=(converted.numerator+converted.denominator-1n)/converted.denominator,key=JSON.stringify([account.id,securityId]);review.bounds.set(key,ceil>(review.bounds.get(key)??0n)?ceil:review.bounds.get(key)??0n);}catch(e){review.issueCount++;if(review.issues.length<100)review.issues.push({accountId:account.id,accountName:account.name,securityId,ticker:tickers.get(securityId)??'',priceId:price.id,date:price.date,fromCurrency:price.currency,toCurrency:account.currency,error:(e as Error).message});}});
 reviews.set(state,review);return review;
}
export function changedMarketAccounts(before:FinanceState,after:FinanceState){
 const changed=new Map<string,string>();if(before.profile?.marketFx!==1&&after.profile?.marketFx!==1)return changed;
 if(before.profile?.marketFx!==after.profile?.marketFx)return reviewMarketPrices(after.profile?.marketFx===1?after:before).affected;
 visitMarketPoints(after,({account,price})=>{const old=foreignMarketPrice(before,price,account.currency),next=foreignMarketPrice(after,price,account.currency);if(old.numerator*next.denominator!==next.numerator*old.denominator){const first=changed.get(account.id);if(!first||price.date<first)changed.set(account.id,price.date);}});return changed;
}
