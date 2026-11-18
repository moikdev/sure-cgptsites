import {validDate,type Account,type FinanceState,type Transaction,type Valuation} from './finance.ts';
import {loanSchedule,loanPeriodInterest,loanRateUnits} from './loans.ts';
import type {LoanTerms} from './loan-types.ts';
export const LOAN_PAYMENT_GRACE_DAYS=5;
export type LoanReplayEligibility='eligible'|'not_loan'|'missing_terms'|'opening_mismatch';
export function loanReplayEligibility(account:Account):LoanReplayEligibility{if(account.type!=='loan')return 'not_loan';const t=account.loanTerms;if(!t||!Number.isSafeInteger(t.initialBalance)||!t.initialBalance||t.initialBalance<0||!t.startDate||!validDate(t.startDate)||!Number.isInteger(t.termMonths)||!t.termMonths||t.termMonths<0||typeof t.annualRate!=='string'||typeof t.rateType!=='string'||!t.rateType.trim())return 'missing_terms';return account.openingDate===t.startDate&&account.openingBalance===-t.initialBalance?'eligible':'opening_mismatch';}
export interface LoanPrincipalChange {date:string;transactionIds:string[];valuationId:string|null;recordedNet:number;principalPaid:number;principalAdded:number;interestPaid:number;insurancePaid:number;separateInterestAssumed:number;balance:number;carriedInterest:number;periodInterest:number|null;}
export interface LoanPrincipalReplay {asOf:string;evaluatedThrough:string;balance:number;changes:LoanPrincipalChange[];totals:{principalPaid:number;principalAdded:number;interestPaid:number;insurancePaid:number;separateInterestAssumed:number};}
const number=(n:bigint)=>{const value=Number(n);if(!Number.isSafeInteger(value))throw new Error('Loan replay exceeds the supported integer range.');return value;},min=(a:bigint,b:bigint)=>a<b?a:b,round=(n:bigint,d:bigint)=>(n*2n+d)/(d*2n);
const scheduleCache=new Map<LoanTerms,{key:string;value:ReturnType<typeof loanSchedule>}>();
function scheduleFor(terms:LoanTerms){const key=JSON.stringify(terms),cached=scheduleCache.get(terms);if(cached?.key===key){scheduleCache.delete(terms);scheduleCache.set(terms,cached);return cached.value;}const value=loanSchedule(terms);scheduleCache.delete(terms);scheduleCache.set(terms,{key,value});while(scheduleCache.size>4)scheduleCache.delete(scheduleCache.keys().next().value!);return value;}
/** Original US 30/360 stub rule; full scheduled months keep the existing schedule's twelfth. */
export function loanReplayInterest(balance:bigint,rate:string,start:string,end:string,dayCount:LoanTerms['dayCount'],fullPeriod:boolean){if(end<start)throw new Error('Loan interest period ends before it starts.');if(dayCount!=='thirty_360'||fullPeriod)return loanPeriodInterest(balance,loanRateUnits(rate),start,end,dayCount);const [sy,sm,sd]=start.split('-').map(Number),[ey,em,ed]=end.split('-').map(Number),first=sd===31?30:sd,last=ed===31&&first===30?30:ed,days=360*(ey-sy)+30*(em-sm)+last-first;return round(balance*loanRateUnits(rate)*BigInt(days),100_000n*360n);}
/** Replays native root entries; ledger amounts and existing end-of-day valuation anchors are never rewritten. */
export function replayLoanPrincipal(account:Account,state:Pick<FinanceState,'transactions'|'valuations'>,asOf:string):LoanPrincipalReplay|null{
 if(!validDate(asOf))throw new Error('Choose a supported loan replay date.');if(loanReplayEligibility(account)!=='eligible')return null;
 const terms=account.loanTerms!,schedule=scheduleFor(terms);if(!schedule)return null;
 if(asOf<account.openingDate)return {asOf,evaluatedThrough:asOf,balance:0,changes:[],totals:{principalPaid:0,principalAdded:0,interestPaid:0,insurancePaid:0,separateInterestAssumed:0}};
 const entries=state.transactions.filter(t=>t.accountId===account.id&&t.date>=account.openingDate&&t.date<=asOf),valuations=state.valuations.filter(v=>v.accountId===account.id&&v.date>=account.openingDate&&v.date<=asOf),transactionsByDate=new Map<string,Transaction[]>(),valuationsByDate=new Map<string,Valuation>();
 for(const t of entries){const list=transactionsByDate.get(t.date)??[];list.push(t);transactionsByDate.set(t.date,list);}for(const v of valuations)if(!valuationsByDate.has(v.date))valuationsByDate.set(v.date,v);
 const lastEntry=[...entries.map(t=>t.date),...valuations.map(v=>v.date)].sort().at(-1),timeline=[...new Set([...transactionsByDate.keys(),...valuationsByDate.keys(),...schedule.payments.filter(p=>lastEntry&&p.date<=lastEntry).map(p=>p.date)])].sort(),scheduled=new Set([account.openingDate,...schedule.payments.map(p=>p.date)]),changes:LoanPrincipalChange[]=[],premiumRemaining=new Map<number,bigint>(),transferCounts=new Map<string,number>();
 for(const t of state.transactions)if(t.transferId)transferCounts.set(t.transferId,(transferCounts.get(t.transferId)??0)+1);
 let principal=BigInt(-account.openingBalance),carried=0n,periodInterest:bigint|null=null,periodStart=account.openingDate,periodPrincipal=principal,index=0;
 const rates=[...terms.rateChanges].sort((a,b)=>a.date.localeCompare(b.date)),rateOn=(date:string)=>terms.rateType==='fixed'?terms.annualRate!:rates.findLast(r=>r.date<=date)?.rate??terms.annualRate!;
 const current=()=>schedule.payments[index],due=(date:string)=>current()?.date===date,grace=(date:string)=>{const days=(Date.parse(date)-Date.parse(periodStart))/86400000;return scheduled.has(periodStart)&&days>0&&days<=LOAN_PAYMENT_GRACE_DAYS;};
 const charge=()=>{const payment=current();if(!payment||payment.date<=periodStart)return;periodInterest=periodPrincipal<=0n?0n:loanReplayInterest(periodPrincipal,rateOn(periodStart),periodStart,payment.date,terms.dayCount,scheduled.has(periodStart));};
 const close=(date:string)=>{if(!due(date))return;carried+=periodInterest??0n;periodInterest=null;periodStart=date;periodPrincipal=principal;index++;};
 const applyGrace=(date:string,amount:bigint)=>{if(amount>0n&&grace(date))periodPrincipal-=amount;};
 for(const date of timeline){
  while(current()&&current().date<date){if(periodInterest===null)charge();close(current().date);}
  const rows=transactionsByDate.get(date)??[];
  if(periodInterest===null&&(due(date)||carried<=0n&&!grace(date)&&rows.length>0))charge();
  let paid=0n,added=0n,interest=0n,insurance=0n,separate=0n;
  for(const t of rows)if(t.amount<0)added+=BigInt(-t.amount);principal+=added;
  const payment=due(date)?current():carried>0n&&index>0?schedule.payments[index-1]:current()??schedule.payments.at(-1);
  const isPrincipalOnly=(t:Transaction)=>terms.principalOnlyTransfers&&!!t.transferId&&(transferCounts.get(t.transferId)??0)===2;
  for(const t of rows)if(t.amount>0&&isPrincipalOnly(t)){const applied=BigInt(t.amount);principal-=applied;paid+=applied;applyGrace(date,applied);let assumed=carried;carried=0n;if(periodInterest!==null&&periodInterest>0n){assumed+=periodInterest;periodInterest=0n;}interest+=assumed;separate+=assumed;}
  const full=rows.filter(t=>t.amount>0&&!isPrincipalOnly(t)).reduce((n,t)=>n+BigInt(t.amount),0n);
  if(full>0n){const fromCarried=min(full,carried);carried-=fromCarried;let fromPeriod=0n;if(periodInterest!==null){fromPeriod=min(full-fromCarried,periodInterest);periodInterest-=fromPeriod;}const interestPaid=fromCarried+fromPeriod;let remaining=full-interestPaid;interest+=interestPaid;
   if(payment){const premium=premiumRemaining.get(payment.number)??BigInt(payment.insurance),covered=min(remaining,premium);premiumRemaining.set(payment.number,premium-covered);remaining-=covered;insurance+=covered;}
   principal-=remaining;paid+=remaining;applyGrace(date,remaining);
  }
  const valuation=valuationsByDate.get(date);if(valuation){principal=BigInt(-valuation.amount);carried=0n;periodInterest=null;periodStart=date;periodPrincipal=principal;while(current()&&current().date<=date)index++;}
  if(due(date))close(date);
  // The original caller records payment facts even when an end-of-day valuation resets that same day's principal.
  if(rows.length||valuation)changes.push({date,transactionIds:rows.map(t=>t.id),valuationId:valuation?.id??null,recordedNet:number(rows.reduce((n,t)=>n+BigInt(t.amount),0n)),principalPaid:number(paid),principalAdded:number(added),interestPaid:number(interest),insurancePaid:number(insurance),separateInterestAssumed:number(separate),balance:number(-principal),carriedInterest:number(carried),periodInterest:periodInterest===null?null:number(periodInterest)});
 }
 const total=(key:'principalPaid'|'principalAdded'|'interestPaid'|'insurancePaid'|'separateInterestAssumed')=>number(changes.reduce((n,c)=>n+BigInt(c[key]),0n));
 return {asOf,evaluatedThrough:lastEntry??account.openingDate,balance:number(-principal),changes,totals:{principalPaid:total('principalPaid'),principalAdded:total('principalAdded'),interestPaid:total('interestPaid'),insurancePaid:total('insurancePaid'),separateInterestAssumed:total('separateInterestAssumed')}};
}
