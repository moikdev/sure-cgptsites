import {taxAdvantaged} from './account-details.ts';
import {accountBalance,precision,reportingTransactions,BUDGET_EXCLUDED_KINDS,sumMinorUnits,type Currency,type FinanceState,type Transaction} from './finance.ts';
import {goalAccountShares} from './goals.ts';
import {findRate,convertAtRate,type FxQuote} from './fx.ts';
import {pow10,roundDivide,safeMinorUnits} from './decimal.ts';
import type {BudgetBook,BudgetPeriod} from './budget-types.ts';
export interface BudgetQuote {from:Currency;to:Currency;requestedDate:string;date:string;source:FxQuote['source'];ageDays:number;numerator:string;denominator:string;}
export interface BudgetFxIssue {context:'transaction'|'bill'|'cash';id:string;name:string;categoryId:string|null;from:Currency;to:Currency;date:string;reason:'rate'|'range';nativeAmount?:number;income?:boolean;}
export interface BudgetEntry extends Transaction {nativeAmount:number;normalizedNativeAmount:number;nativeCurrency:Currency;conversion:BudgetQuote|null;splitRounding:boolean;}
export const budgetQuote=(from:Currency,to:Currency,requestedDate:string,q:FxQuote):BudgetQuote|null=>from===to?null:{from,to,requestedDate,date:q.date,source:q.source,ageDays:q.ageDays,numerator:String(q.numerator),denominator:String(q.denominator)};
// Split siblings share one rounded conversion of their eligible signed total.
// Mathematical floors and largest remainders also conserve mixed-sign refunds.
// Stable split position order, rather than IDs, breaks ties across restores.
export function convertBudgetParts(amounts:number[],from:Currency,to:Currency,q:Pick<FxQuote,'numerator'|'denominator'>){
 const d=q.denominator*pow10(precision(from)),n=amounts.map(amount=>BigInt(amount)*q.numerator*pow10(precision(to))),parts=n.map((value,index)=>{const truncated=value/d,floor=truncated-(value<0n&&value%d!==0n?1n:0n);return {index,value:floor,remainder:value-floor*d};}),target=roundDivide(n.reduce((sum,v)=>sum+v,0n),d);let left=target-parts.reduce((sum,p)=>sum+p.value,0n);
 for(const p of [...parts].sort((a,b)=>a.remainder===b.remainder?a.index-b.index:a.remainder>b.remainder?-1:1))if(left>0n){p.value++;left--;}
 if(left!==0n)throw new Error('Split conversion could not preserve its total.');return parts.map(p=>safeMinorUnits(p.value));
}
export function convertedBudgetEntries(state:FinanceState,book:BudgetBook,period:BudgetPeriod,asOf:string,nativeOnly=false){
 const accounts=new Map(state.accounts.map(a=>[a.id,a])),chosen=new Set(book.accountIds),groups=new Map<string,Transaction[]>(),entries:BudgetEntry[]=[],issues:BudgetFxIssue[]=[];
 for(const t of reportingTransactions(state)){const a=accounts.get(t.accountId);if(!a||a.excludedFromReports||taxAdvantaged(a)||t.excluded||BUDGET_EXCLUDED_KINDS.includes(t.kind)||t.date<period.startDate||t.date>period.endDate||t.date>asOf||book.accountMode==='selected'&&!chosen.has(a.id)||nativeOnly&&a.currency!==period.currency)continue;const key=t.splitParentId??t.id,rows=groups.get(key)??[];rows.push(t);groups.set(key,rows);}
 for(const rows of groups.values()){
  const from=accounts.get(rows[0].accountId)!.currency,date=rows[0].date,amounts=rows.map(t=>['loan_payment','investment_contribution'].includes(t.kind)?-Math.abs(t.amount):t.amount),quote=findRate(state,from,period.currency,date);let converted:number[]|null=null,reason:BudgetFxIssue['reason']='rate';
  if(quote)try{converted=convertBudgetParts(amounts,from,period.currency,quote);}catch{reason='range';}
  if(!converted){rows.forEach((t,i)=>issues.push({context:'transaction',id:t.id,name:t.name,categoryId:t.categoryId,from,to:period.currency,date,reason,nativeAmount:t.amount,income:amounts[i]>0}));continue;}
  rows.forEach((t,i)=>entries.push({...t,amount:converted![i],nativeAmount:t.amount,normalizedNativeAmount:amounts[i],nativeCurrency:from,conversion:budgetQuote(from,period.currency,date,quote!),splitRounding:rows.length>1&&from!==period.currency}));
 }
 return {entries,issues,unconvertedEntries:issues.length};
}
export function budgetCashSummary(state:FinanceState,book:BudgetBook,currency:Currency,asOf:string,nativeOnly=false,strict=false){
 const chosen=new Set(book.accountIds),issues:BudgetFxIssue[]=[],rows=state.accounts.filter(a=>['checking','savings'].includes(a.type)&&!a.archived&&!a.excludedFromReports&&(book.accountMode==='all'||chosen.has(a.id))&&(!nativeOnly||a.currency===currency)).map(a=>{
  const nativeBalance=accountBalance(a,state,asOf),nativeReserved=sumMinorUnits([...goalAccountShares(state,a.id,asOf).values()]);let convertedBalance:number|null=null,convertedReserved:number|null=null,quote:BudgetQuote|null=null,reason:BudgetFxIssue['reason']='rate';
  try{const q=findRate(state,a.currency,currency,asOf);if(nativeBalance===0&&nativeReserved===0){convertedBalance=0;convertedReserved=0;}else if(q){reason='range';convertedBalance=convertAtRate(nativeBalance,a.currency,currency,q);convertedReserved=convertAtRate(nativeReserved,a.currency,currency,q);quote=budgetQuote(a.currency,currency,asOf,q);}}catch{if(strict&&a.currency===currency)throw new Error('The cash total exceeds the supported integer range.');reason='range';convertedBalance=null;convertedReserved=null;}
  if(convertedBalance===null||convertedReserved===null){convertedBalance=null;convertedReserved=null;issues.push({context:'cash',id:a.id,name:a.name,categoryId:null,from:a.currency,to:currency,date:asOf,reason});}
  return {accountId:a.id,name:a.name,currency:a.currency,nativeBalance,nativeReserved,convertedBalance,convertedReserved,quote};
 });
 let rangeError=false;const sum=(values:number[])=>{try{return sumMinorUnits(values);}catch(e){if(strict)throw e;rangeError=true;return null;}},cashOnHand=sum(rows.map(r=>r.convertedBalance??0)),goalReserved=sum(rows.map(r=>r.convertedReserved??0)),cashAvailable=cashOnHand===null||goalReserved===null?null:sum([cashOnHand,-goalReserved]);
 return {cashOnHand,goalReserved,cashAvailable,cashRows:rows,cashIssues:issues,cashRangeError:rangeError,cashComplete:!issues.length&&!rangeError,missingCashCurrencies:[...new Set(issues.map(i=>i.from))]};
}
