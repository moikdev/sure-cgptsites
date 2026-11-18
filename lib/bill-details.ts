import {today,validDate,moneyInput,type FinanceState,type RecurringEntry} from './finance.ts';
import {addDays,schedulePairs} from './recurring.ts';
import {createBillContext,createBillSchedules,shiftBillMonth} from './bills-workspace.ts';
import {roundDivide,safeMinorUnits} from './decimal.ts';
import {toCSV} from './csv.ts';
export const BILL_DETAIL_SECTIONS=['history','open','payments','prices'] as const;
export const BILL_DETAIL_PAGE_SIZE=12;
export class BillDetailError extends Error {status:number;constructor(status:number,message:string){super(message);this.status=status;}}
const cap=(date:string)=>date<'1900-01-01'?'1900-01-01':date>'2199-12-31'?'2199-12-31':date;
const total=(values:number[])=>{try{return safeMinorUnits(values.reduce((n,v)=>n+BigInt(v),0n));}catch{return null;}};
const average=(values:number[])=>{if(!values.length)return null;try{return safeMinorUnits(roundDivide(values.reduce((n,v)=>n+BigInt(v),0n),BigInt(values.length)));}catch{return null;}};
export function billCadenceCost(entry:RecurringEntry){
 let numerator=0n,denominator=1n;
 for(const rule of entry.rules.length?entry.rules:[{frequency:'monthly',interval:1}]){
  const n=rule.frequency==='weekly'?1461n:rule.frequency==='monthly'?12n:1n,d=BigInt(rule.interval)*(rule.frequency==='weekly'?28n:1n);
  numerator=numerator*d+n*denominator;denominator*=d;
 }
 const amount=BigInt(Math.abs(entry.amount))*numerator;
 const value=(d:bigint)=>{try{return safeMinorUnits(roundDivide(amount,d));}catch{return null;}};
 return {monthly:value(12n*denominator),annual:value(denominator)};
}
export function createBillDetail(state:FinanceState,recurringEntryId:string,{asOf=today(),originalDueOn}:{asOf?:string;originalDueOn?:string}={}){
 if(!validDate(asOf)||originalDueOn!==undefined&&!validDate(originalDueOn))throw new BillDetailError(400,'Choose supported bill dates.');
 const entry=state.recurringEntries.find(e=>e.id===recurringEntryId);if(!entry)throw new BillDetailError(404,'That schedule could not be found.');
 const occurrences=state.recurringOccurrences.filter(o=>o.recurringEntryId===entry.id),ids=new Set(occurrences.map(o=>o.id)),allocations=state.recurringAllocations.filter(a=>ids.has(a.occurrenceId));
 if(occurrences.length>20000||allocations.length>20000)throw new BillDetailError(400,'This bill has more than 20,000 history records. Export or reduce its history before opening the report.');
 const scoped={...state,recurringEntries:[entry],recurringOccurrences:occurrences,recurringAllocations:allocations},c=createBillContext(scoped,asOf,entry.currency);
 const currentDefault=createBillSchedules(scoped,{asOf,currency:entry.currency,status:entry.status==='ended'?'ended':'current'}).rows[0]?.current??null;
 let current=currentDefault;
 if(originalDueOn){
  const occurrence=occurrences.find(o=>o.originalDueOn===originalDueOn)??c.rows(entry,cap(addDays(originalDueOn,-3)),cap(addDays(originalDueOn,3))).find(o=>o.originalDueOn===originalDueOn);
  if(!occurrence)throw new BillDetailError(404,'That occurrence does not belong to this schedule.');current=c.row(entry,occurrence);
 }
 const confirmed=allocations.filter(a=>a.state==='confirmed'),confirmedByOccurrence=new Map<string,typeof confirmed>();
 for(const a of confirmed){const rows=confirmedByOccurrence.get(a.occurrenceId)??[];rows.push(a);confirmedByOccurrence.set(a.occurrenceId,rows);}
 const transactions=new Map(state.transactions.map(t=>[t.id,t])),accounts=new Map(state.accounts.map(a=>[a.id,a])),parts=new Map(state.splitLines.map(l=>[l.id,l])),byId=new Map(occurrences.map(o=>[o.id,o]));
 const payments=allocations.map(allocation=>{
  const transaction=allocation.transactionId?transactions.get(allocation.transactionId)??null:null,split=allocation.splitLineId?parts.get(allocation.splitLineId)??null:null,account=transaction?accounts.get(transaction.accountId)??null:null;
  return {allocation,occurrence:byId.get(allocation.occurrenceId)!,transaction,split,account,originalAccount:allocation.conversion?accounts.get(allocation.conversion.accountId)??null:null,sourceName:split?.name??transaction?.name??null};
 }).sort((a,b)=>(b.allocation.paidOn??'').localeCompare(a.allocation.paidOn??'')||a.allocation.id.localeCompare(b.allocation.id));
 const decorate=(occurrence:typeof occurrences[number])=>{const records=confirmedByOccurrence.get(occurrence.id)??[];return {...c.row(entry,occurrence),paymentCount:records.length,paymentNames:records.slice(0,3).map(a=>{const t=a.transactionId?transactions.get(a.transactionId):null;return a.splitLineId?parts.get(a.splitLineId)?.name??t?.name??'Manual record':t?.name??'Manual record';})};};
 const history=occurrences.filter(o=>o.status!=='scheduled').sort((a,b)=>b.dueOn.localeCompare(a.dueOn)||a.id.localeCompare(b.id)).map(decorate);
 const from=[entry.startsOn,...occurrences.filter(o=>o.status==='scheduled').map(o=>o.dueOn)].sort()[0],through=cap(addDays(asOf,400));
 const open=c.rows(entry,from,through).filter(o=>o.status==='scheduled').map(decorate).sort((a,b)=>a.dueOn.localeCompare(b.dueOn)||a.occurrence.id.localeCompare(b.occurrence.id));
 // A stored distant open cycle remains reachable even beyond the preview horizon.
 const openIds=new Set(open.map(r=>r.occurrence.id));for(const o of occurrences)if(o.status==='scheduled'&&!openIds.has(o.id))open.push(decorate(o));
 if(open.length>20000)throw new BillDetailError(400,'This bill has more than 20,000 open occurrences. Close obsolete obligations before opening the report.');
 open.sort((a,b)=>a.dueOn.localeCompare(b.dueOn)||a.occurrence.id.localeCompare(b.occurrence.id));
 const latestPaid=history.find(r=>r.occurrence.status==='paid'&&r.paymentCount>0)??null;
 const seen=new Set<string>(),upcoming=schedulePairs(entry,cap(addDays(asOf,1)),through).filter(p=>{if(p.dueOn<=asOf||seen.has(p.dueOn))return false;seen.add(p.dueOn);return true;}).slice(0,3).map(p=>({...p,amount:Math.abs(entry.amount),currency:entry.currency}));
 const paidCycles=occurrences.filter(o=>o.status==='paid'&&confirmedByOccurrence.has(o.id)).map(o=>confirmedByOccurrence.get(o.id)!.reduce((n,a)=>n+BigInt(a.amount),0n));
 const sumBig=(values:bigint[])=>values.reduce((n,v)=>n+v,0n),safeBig=(n:bigint)=>{try{return safeMinorUnits(n);}catch{return null;}};
 const yearStart=asOf.slice(0,4)+'-01-01',cadence=billCadenceCost(entry),analytics=paidCycles.length?{count:paidCycles.length,average:safeBig(roundDivide(sumBig(paidCycles),BigInt(paidCycles.length))),lowest:safeBig(paidCycles.reduce((a,b)=>a<b?a:b)),highest:safeBig(paidCycles.reduce((a,b)=>a>b?a:b))}:null;
 const ytdRecords=confirmed.filter(a=>!!a.paidOn&&a.paidOn>=yearStart),ytd=total(ytdRecords.map(a=>a.amount)),futureDatedCount=ytdRecords.filter(a=>a.paidOn!>asOf).length,undatedCount=confirmed.filter(a=>!a.paidOn).length;
 const windowMonth=shiftBillMonth(asOf.slice(0,7),-11),months=Array.from({length:12},(_,i)=>shiftBillMonth(windowMonth,i)),byMonth=new Map<string,number[]>(),byYear=new Map<string,number[]>();
 for(const a of confirmed){const due=byId.get(a.occurrenceId)!.dueOn,month=due.slice(0,7),year=due.slice(0,4),monthly=byMonth.get(month)??[],yearly=byYear.get(year)??[];monthly.push(a.amount);yearly.push(a.amount);byMonth.set(month,monthly);byYear.set(year,yearly);}
 const paymentHistory=months.map(month=>{const records=byMonth.get(month)??[];return {month,total:total(records),paymentCount:records.length};}),yearlyMetrics=[...byYear].sort(([a],[b])=>b.localeCompare(a)).map(([year,amounts])=>({year:Number(year),total:total(amounts),average:average(amounts),paymentCount:amounts.length}));
 const datedLinked=payments.filter(p=>p.allocation.state==='confirmed'&&p.account&&p.allocation.paidOn),latestDate=datedLinked[0]?.allocation.paidOn??null,latestAccounts=[...new Map(datedLinked.filter(p=>p.allocation.paidOn===latestDate).map(p=>[p.account!.id,p.account!])).values()];
 const prices=state.recurringPriceChanges.filter(p=>p.recurringEntryId===entry.id).sort((a,b)=>b.effectiveOn.localeCompare(a.effectiveOn)||a.id.localeCompare(b.id));
 return {asOf,revision:state.profile?.revision??0,entry,currency:entry.currency,current,latestPaid,cadence,analytics,ytd,yearStart,futureDatedCount,undatedCount,paymentHistory,yearlyMetrics,
  latestLinked:{date:latestDate,accounts:latestAccounts,undatedCount:payments.filter(p=>p.allocation.state==='confirmed'&&p.account&&!p.allocation.paidOn).length},
  metadata:{account:entry.accountId?accounts.get(entry.accountId)??null:null,destination:entry.destinationAccountId?accounts.get(entry.destinationAccountId)??null:null,category:state.categories.find(c=>c.id===entry.categoryId)??null,merchant:state.merchants.find(m=>m.id===entry.merchantId)??null,tags:state.tags.filter(t=>entry.tagIds.includes(t.id))},
  upcoming,upcomingThrough:through,sections:{history,open,payments,prices}};
}
export function billDetailPage(report:ReturnType<typeof createBillDetail>,section:typeof BILL_DETAIL_SECTIONS[number]='history',offset=0){
 const rows=report.sections[section];if(!Number.isInteger(offset)||offset<0||offset>20000||offset>0&&offset>=rows.length)throw new BillDetailError(400,'Choose an available bill history page.');
 const {sections,...summary}=report;return {...summary,section,counts:Object.fromEntries(BILL_DETAIL_SECTIONS.map(key=>[key,sections[key].length])),page:{offset,limit:BILL_DETAIL_PAGE_SIZE,total:rows.length,rows:rows.slice(offset,offset+BILL_DETAIL_PAGE_SIZE)}};
}
export function billDetailCSV(report:ReturnType<typeof createBillDetail>){
 const rows:(string|number)[][]=[['Schedule','Bill currency','Original due','Scheduled due','Effective due','Occurrence state','Payment state','Bill amount','Paid on','Source','Account','Source currency','Source amount','Account entry date','Applied rate numerator','Applied rate denominator','Quote date','Quote source']];
 for(const p of report.sections.payments){const a=p.allocation,converted=a.conversion,o=p.occurrence;rows.push([report.entry.name,a.currency,o.originalDueOn,o.dueOn,o.snoozedUntil&&o.snoozedUntil>o.dueOn?o.snoozedUntil:o.dueOn,o.status,a.state,moneyInput(a.amount,a.currency),a.paidOn??'',p.sourceName??(converted?'Unlinked payment record':'Manual record'),p.account?.name??p.originalAccount?.name??'',converted?.sourceCurrency??a.sourceCurrency??'',converted?moneyInput(converted.sourceAmount,converted.sourceCurrency):a.sourceAmount!==null&&a.sourceCurrency?moneyInput(a.sourceAmount,a.sourceCurrency):'',converted?.sourceDate??p.transaction?.date??'',converted?.rateNumerator??'',converted?.rateDenominator??'',converted?.rateDate??'',converted?.rateSource??'']);}
 return toCSV(rows);
}
