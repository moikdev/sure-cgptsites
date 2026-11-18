import {createBillPayPeriods,billPayPeriodPage} from './bill-pay-periods.ts';
import {money, precision, sumMinorUnits, today, validDate, type Currency, type FinanceState, type RecurringEntry, type RecurringOccurrence} from './finance.ts';
import {addDays, occurrencesBetween, occurrenceScheduleState, schedulePairs} from './recurring.ts';
import {findRate, convertAtRate} from './fx.ts';
import {budgetQuote, type BudgetQuote} from './budget-fx.ts';
import {materialPriceChange} from './recurring-prices.ts';
import {subscriptionCommitments} from './recurring-lifecycle.ts';

export const BILL_PAGE_SIZE=25;
export const BILL_STATUSES=['current','overdue','due','partial','paid','paused','ended'] as const;
export const BILL_TYPES=['all','bill','subscription','installment','income','transfer','other'] as const;
export const BILL_SECTIONS=['overdue','month','later','dormant'] as const;
export interface BillRow {
 entry:RecurringEntry; occurrence:RecurringOccurrence; dueOn:string; scheduleState:ReturnType<typeof occurrenceScheduleState>;
 expected:number; paid:number; remaining:number; partial:boolean; suggestionIds:string[];
 attention:'paused'|'review'|'partial'|'overdue'|'price'|null;
 action:'review'|'add_payment'|'pay'|'find_payment'|null;
 tone:'paid'|'changed'|'muted'|'overdue'|'neutral';
 converted:{expected:number|null;paid:number|null;remaining:number|null;quote:BudgetQuote|null};
}
export interface BillTotal {total:number|null;known:number|null;missing:number;range:boolean;count:number;}
export const monthEnd=(month:string)=>new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
export function shiftBillMonth(month:string,delta:number){return new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5))-1+delta,1)).toISOString().slice(0,7);}
const capDate=(date:string)=>date<'1900-01-01'?'1900-01-01':date>'2199-12-31'?'2199-12-31':date;
const effective=(o:RecurringOccurrence)=>o.snoozedUntil&&o.snoozedUntil>o.dueOn?o.snoozedUntil:o.dueOn;
const byDate=(a:BillRow,b:BillRow)=>a.dueOn.localeCompare(b.dueOn)||a.entry.id.localeCompare(b.entry.id)||a.occurrence.originalDueOn.localeCompare(b.occurrence.originalDueOn);
export function payableBill(state:FinanceState,entry:RecurringEntry){return ['active','inactive','paused'].includes(entry.status)&&entry.amount<0&&(!entry.destinationAccountId||state.accounts.some(a=>a.id===entry.destinationAccountId&&['credit','loan'].includes(a.type)));}
export function createBillContext(state:FinanceState,asOf:string,currency:Currency){
 if(!validDate(asOf))throw new Error('Choose a supported bills date.');
 const own=new Map<string,RecurringOccurrence[]>(),paid=new Map<string,number>(),suggestions=new Map<string,string[]>(),changed=new Set<string>();
 for(const o of state.recurringOccurrences){const list=own.get(o.recurringEntryId)??[];list.push(o);own.set(o.recurringEntryId,list);}
 const amounts=new Map<string,number[]>();
 for(const a of state.recurringAllocations)if(a.state==='confirmed'){const list=amounts.get(a.occurrenceId)??[];list.push(a.amount);amounts.set(a.occurrenceId,list);}else{const list=suggestions.get(a.occurrenceId)??[];list.push(a.id);suggestions.set(a.occurrenceId,list);}
 for(const [id,list] of amounts)paid.set(id,sumMinorUnits(list));
 for(const c of state.recurringPriceChanges)if(c.effectiveOn>=addDays(asOf,-30)&&materialPriceChange(c.previousAmount,c.newAmount))changed.add(c.recurringEntryId);
 const histories=new Map<string,RecurringOccurrence[]>();
 for(const [id,list] of own)histories.set(id,list.filter(o=>o.status==='paid'&&(paid.get(o.id)??0)>0).sort((a,b)=>a.originalDueOn.localeCompare(b.originalDueOn)));
 let generatedCount=0;
 const rows=(entry:RecurringEntry,from:string,to:string)=>{
  const originals=own.get(entry.id)??[],byId=new Map(originals.map(o=>[o.id,o]));
  // Select by raw due date (calendar placement and Source's 90-day horizon).
  // Restore snoozes after generation; they affect state and rail order only.
  const found=occurrencesBetween(entry,originals.map(o=>({...o,snoozedUntil:null})),[],from,to).map(o=>byId.get(o.id)??o);
  generatedCount+=found.length;if(generatedCount>20000)throw new Error('Bills have more than 20,000 occurrences. Narrow the calendar or close obsolete schedules.');
  return found;
 };
 const row=(entry:RecurringEntry,occurrence:RecurringOccurrence):BillRow=>{
  let expected=occurrence.expectedAmount??(entry.amountStrategy==='average'?entry.expectedAmountAvg:null)??Math.abs(entry.amount);
  if(occurrence.expectedAmount===null&&entry.amountStrategy==='last'){
   const history=histories.get(entry.id)??[];let low=0,high=history.length;
   while(low<high){const mid=Math.floor((low+high)/2);if(history[mid].originalDueOn<occurrence.originalDueOn)low=mid+1;else high=mid;}
   if(low)expected=paid.get(history[low-1].id)!;
  }
  const confirmed=paid.get(occurrence.id)??0,remaining=Math.max(0,expected-confirmed),partial=occurrence.status==='scheduled'&&confirmed>0&&confirmed<expected,scheduleState=occurrenceScheduleState(entry,occurrence,asOf),suggestionIds=suggestions.get(occurrence.id)??[];
  const attention=entry.status!=='active'?'paused':suggestionIds.length?'review':partial?'partial':scheduleState==='overdue'?'overdue':changed.has(entry.id)?'price':null;
  const validUrl=entry.paymentUrl&&/^https?:\/\//i.test(entry.paymentUrl);
  const action=entry.status!=='active'||occurrence.status!=='scheduled'?null:suggestionIds.length?'review':!['due','overdue'].includes(scheduleState)?null:partial?'add_payment':entry.autopay&&scheduleState==='due'?null:validUrl?'pay':'find_payment';
  const delta=BigInt(confirmed)-BigInt(expected),changedAmount=(delta<0n?-delta:delta)*100n>10n**BigInt(precision(entry.currency));
  const tone=occurrence.status==='paid'?(changedAmount?'changed':'paid'):occurrence.status!=='scheduled'?'muted':entry.status==='active'&&scheduleState==='overdue'?'overdue':'neutral';
  const quote=findRate(state,entry.currency,currency,asOf);
  const convert=(amount:number)=>{if(!amount)return 0;if(!quote)return null;try{return convertAtRate(amount,entry.currency,currency,quote);}catch{return null;}};
  return {entry,occurrence,dueOn:effective(occurrence),scheduleState,expected,paid:confirmed,remaining,partial,suggestionIds:[...suggestionIds].sort(),attention,action,tone,converted:{expected:convert(expected),paid:convert(confirmed),remaining:convert(remaining),quote:quote?budgetQuote(entry.currency,currency,asOf,quote):null}};
 };
 return {own,rows,row};
}
export function billTotal(rows:BillRow[],field:'expected'|'paid'|'remaining'):BillTotal{
 const values=rows.map(r=>r.converted[field]),missing=values.filter(v=>v===null).length;let known:number|null=null,range=false;
 try{known=sumMinorUnits(values.filter((v):v is number=>v!==null));}catch{range=true;}
 return {total:missing||range?null:known,known,missing,range,count:rows.length};
}
export function createBillsOverview(state:FinanceState,{asOf=today(),currency=state.profile?.currency??'USD'}:{asOf?:string;currency?:Currency}={}){
 const c=createBillContext(state,asOf,currency),start=asOf.slice(0,7)+'-01',end=monthEnd(asOf.slice(0,7)),horizon=capDate(addDays(asOf,90));
 const all=state.recurringEntries.filter(e=>payableBill(state,e)).flatMap(entry=>{
  const dates=[entry.startsOn,...(c.own.get(entry.id)??[]).filter(o=>o.status==='scheduled'||effective(o)>=start).map(o=>o.dueOn)].sort();
  return c.rows(entry,dates[0],horizon).filter(o=>o.status==='scheduled'||effective(o)>=start).map(o=>c.row(entry,o));
 });
 const open=all.filter(r=>r.occurrence.status==='scheduled'),active=open.filter(r=>r.entry.status==='active'),dormant=open.filter(r=>r.entry.status!=='active').sort(byDate),overdue=active.filter(r=>r.scheduleState==='overdue').sort(byDate),upcoming=active.filter(r=>r.scheduleState!=='overdue');
 const thisMonth=upcoming.filter(r=>r.dueOn<=end).sort(byDate),laterAll=upcoming.filter(r=>r.dueOn>end).sort(byDate),seen=new Set<string>(),later=laterAll.filter(r=>{if(seen.has(r.entry.id))return false;seen.add(r.entry.id);return true;});
 const paid=all.filter(r=>r.occurrence.status==='paid'&&r.dueOn>=start&&r.dueOn<=end).sort(byDate),month=[...thisMonth,...paid].sort(byDate),owed=[...overdue,...thisMonth],window=upcoming.filter(r=>r.dueOn>=asOf&&r.dueOn<=capDate(addDays(asOf,6)));
 const needsConversion=[...owed,...window.filter(r=>r.dueOn>end)];
 const payPeriods=createBillPayPeriods(state,{asOf,currency,monthEnd:end,horizon,rows:month,counted:[...paid,...upcoming]});
 return {asOf,currency,revision:state.profile?.revision??0,monthStart:start,monthEnd:end,horizon,payPeriods,
  totals:{remaining:billTotal(owed,'remaining'),paid:billTotal(paid,'paid'),nextSeven:billTotal(window,'remaining'),pastDue:billTotal(overdue,'remaining')},
  owedCount:owed.length,needsActionCount:owed.filter(r=>!r.entry.autopay).length,monthBillCount:overdue.length+month.length,unconvertibleCount:needsConversion.filter(r=>r.converted.remaining===null).length,
  sections:{overdue,month,later,dormant},nextUp:[...thisMonth,...later].filter(r=>r.dueOn>=asOf).sort(byDate).slice(0,4),
  suggestedSeries:state.recurringEntries.filter(e=>e.status==='suggested'&&e.billType!=='income').sort((a,b)=>a.name.localeCompare(b.name)),
  suggestions:[...open,...paid].filter(r=>r.suggestionIds.length).sort((a,b)=>a.entry.name.localeCompare(b.entry.name)||byDate(a,b))};
}
export function createBillsCalendar(state:FinanceState,{asOf=today(),currency=state.profile?.currency??'USD',month=asOf.slice(0,7)}:{asOf?:string;currency?:Currency;month?:string}={}){
 const c=createBillContext(state,asOf,currency);if(!validDate(month+'-01'))throw new Error('Choose a supported calendar month.');
 const limit=shiftBillMonth(asOf.slice(0,7),13)>'2199-12'?'2199-12':shiftBillMonth(asOf.slice(0,7),13);month=month>limit?limit:month;
 const start=month+'-01',end=monthEnd(month),gridStart=capDate(addDays(start,-new Date(start+'T00:00:00Z').getUTCDay())),gridEnd=capDate(addDays(end,6-new Date(end+'T00:00:00Z').getUTCDay()));
 const rows=state.recurringEntries.filter(e=>payableBill(state,e)).flatMap(e=>c.rows(e,gridStart,gridEnd).map(o=>c.row(e,o))).sort((a,b)=>a.occurrence.dueOn.localeCompare(b.occurrence.dueOn)||b.expected-a.expected||byDate(a,b));
 const inMonth=rows.filter(r=>r.occurrence.dueOn>=start&&r.occurrence.dueOn<=end),byDay=new Map<string,BillRow[]>();
 for(const row of rows){const date=row.occurrence.dueOn,list=byDay.get(date)??[];list.push(row);byDay.set(date,list);}
 const days=[];for(let date=gridStart;date<=gridEnd;date=addDays(date,1)){const list=byDay.get(date)??[];days.push({date,inMonth:date>=start&&date<=end,count:list.length,chips:list.slice(0,3)});}
 return {asOf,currency,revision:state.profile?.revision??0,month,limit,atForwardLimit:month===limit,gridStart,gridEnd,count:inMonth.length,expected:billTotal(inMonth,'expected'),paid:billTotal(inMonth,'paid'),days,rows};
}
export function createBillSchedules(state:FinanceState,{asOf=today(),currency=state.profile?.currency??'USD',search='',status='current',type='all',sort='status'}:{asOf?:string;currency?:Currency;search?:string;status?:typeof BILL_STATUSES[number];type?:typeof BILL_TYPES[number];sort?:'status'|'name'|'amount'}={}){
 const c=createBillContext(state,asOf,currency),merchants=new Map(state.merchants.map(m=>[m.id,m.name])),needle=search.trim().toLocaleLowerCase();
 const entries=state.recurringEntries.filter(e=>(status==='ended'?e.status==='ended':e.status!=='ended')&&(status!=='paused'||['paused','inactive'].includes(e.status))&&(type==='all'||e.billType===type)&&(!needle||[e.name,merchants.get(e.merchantId??'')??''].some(n=>n.toLocaleLowerCase().includes(needle))));
 const rows=entries.map(entry=>{
  const own=c.own.get(entry.id)??[],from=[entry.startsOn,...own.filter(o=>o.status==='scheduled').map(o=>o.dueOn)].sort()[0],through=capDate(addDays(asOf,90));
  let open=[...own.filter(o=>o.status==='scheduled'),...c.rows(entry,from,through).filter(o=>o.status==='scheduled')].sort((a,b)=>a.dueOn.localeCompare(b.dueOn))[0];
  // A long cadence or already-settled future cycle must not hide the next one.
  if(entry.status==='active'&&(!open||open.dueOn>through)&&through<'2199-12-31'){
   const pairs=schedulePairs(entry,addDays(through,1),'2199-12-31');
   let after=through;
   while(after<'2199-12-31'){
    const next=pairs.find(p=>p.dueOn>after&&(!open||p.dueOn<=open.dueOn));if(!next)break;
    const end=capDate(addDays(next.dueOn,370)),candidate=c.rows(entry,next.dueOn,end).filter(o=>o.status==='scheduled').sort((a,b)=>a.dueOn.localeCompare(b.dueOn))[0];
    if(candidate){if(!open||candidate.dueOn<open.dueOn)open=candidate;break;}after=end;
   }
  }
  const current=open??[...own].filter(o=>o.status!=='scheduled').sort((a,b)=>b.dueOn.localeCompare(a.dueOn))[0];return {entry,current:current?c.row(entry,current):null};
 }).filter(({entry,current})=>!['overdue','due','partial','paid'].includes(status)||!!current&&(status==='partial'?current.partial:status==='paid'?current.occurrence.status==='paid':entry.status==='active'&&current.scheduleState===status));
 rows.sort((a,b)=>sort==='name'?a.entry.name.localeCompare(b.entry.name)||a.entry.id.localeCompare(b.entry.id):sort==='amount'?Math.abs(b.entry.amount)-Math.abs(a.entry.amount)||a.entry.name.localeCompare(b.entry.name):a.entry.status.localeCompare(b.entry.status)||(a.current?.dueOn??'9999').localeCompare(b.current?.dueOn??'9999')||a.entry.id.localeCompare(b.entry.id));
 return {asOf,currency,revision:state.profile?.revision??0,search,status,type,sort,total:rows.length,rows,endedHidden:!rows.length&&status==='current'&&!needle&&type==='all'&&state.recurringEntries.some(e=>e.status==='ended'),commitments:type==='subscription'?subscriptionCommitments({...state,recurringEntries:rows.map(r=>r.entry)}):[]};
}
export function billPage<T>(rows:T[],offset=0){if(!Number.isInteger(offset)||offset<0||offset>20000||(offset>0&&offset>=rows.length))throw new Error('Choose an available bills page.');return {offset,limit:BILL_PAGE_SIZE,total:rows.length,rows:rows.slice(offset,offset+BILL_PAGE_SIZE)};}
export function billsOverviewPage(report:ReturnType<typeof createBillsOverview>,section:typeof BILL_SECTIONS[number]='month',offset=0){const {sections,suggestions,suggestedSeries,...summary}=report,page=billPage(sections[section],offset);return {...summary,section,counts:Object.fromEntries(BILL_SECTIONS.map(key=>[key,sections[key].length])),page,pageMarkers:section==='month'?billPayPeriodPage(report.payPeriods,page.rows):[],suggestions:billPage(suggestions),suggestedSeries:billPage(suggestedSeries)};}
export function billsCalendarPage(report:ReturnType<typeof createBillsCalendar>,day=report.month+'-01',offset=0){if(!validDate(day)||day<report.gridStart||day>report.gridEnd)throw new Error('Choose a day in this calendar.');const {rows,...summary}=report;return {...summary,day,page:billPage(rows.filter(r=>r.occurrence.dueOn===day),offset)};}
export function billsCalendarAgendaPage(report:ReturnType<typeof createBillsCalendar>,offset=0){const inMonth=report.rows.filter(r=>r.occurrence.dueOn>=report.month+'-01'&&r.occurrence.dueOn<=monthEnd(report.month)),page=billPage(inMonth,offset),dates=[...new Set(page.rows.map(r=>r.occurrence.dueOn))];return {offset,limit:BILL_PAGE_SIZE,total:inMonth.length,days:dates.map(date=>{const all=inMonth.filter(r=>r.occurrence.dueOn===date),rows=page.rows.filter(r=>r.occurrence.dueOn===date);return {date,total:all.length,continued:all[0].occurrence.id!==rows[0].occurrence.id,rows};})};}
const escapeICal=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
function foldICal(line:string){const encoder=new TextEncoder();let parts='',chunk='',bytes=0;for(const char of line){const size=encoder.encode(char).length;if(bytes+size>75){parts+=chunk+'\r\n';chunk=' ';bytes=1;}chunk+=char;bytes+=size;}return parts+chunk;}
export function billsICalendar(state:FinanceState,asOf=today(),stamp=new Date().toISOString()){
 const c=createBillContext(state,asOf,state.profile?.currency??'USD'),end=capDate(addDays(asOf,90));if(!Number.isFinite(Date.parse(stamp)))throw new Error('Choose a valid calendar export timestamp.');
 const rows=state.recurringEntries.filter(e=>e.status==='active'&&e.amount<0).flatMap(e=>c.rows(e,asOf,end).filter(o=>o.status==='scheduled').map(o=>c.row(e,o))).sort((a,b)=>a.occurrence.dueOn.localeCompare(b.occurrence.dueOn)||byDate(a,b));
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Sure Sites//Bills//EN','CALSCALE:GREGORIAN','X-WR-CALNAME:Sure bills'];
 for(const row of rows)lines.push('BEGIN:VEVENT',`UID:${escapeICal(row.entry.id+':'+row.occurrence.originalDueOn)}@sure-bills`,`DTSTAMP:${new Date(stamp).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')}`,`DTSTART;VALUE=DATE:${row.dueOn.replace(/-/g,'')}`,`SUMMARY:${escapeICal(row.entry.name)} (${escapeICal(money(row.expected,row.entry.currency))})`,'END:VEVENT');
 lines.push('END:VCALENDAR');return lines.map(foldICal).join('\r\n')+'\r\n';
}
