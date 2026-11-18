import {recurringStateChanges} from './recurring-state.ts';
import {withRecurringHistoryFloor} from './recurring-history.ts';
import {completeActivationHistory} from './recurring-work.ts';
import {validDate,type FinanceState,type RecurringEntry,type RecurringOccurrence} from './finance.ts';
import {addDays,schedulePhasePairs,recurrenceHalfCycle,expectedOccurrenceAmount} from './recurring.ts';
import {planRecurringMatches,applyRecurringMatchPlan,matcherDefaults,matcherWindow,type RecurringMatchCandidate} from './recurring-matcher.ts';
import {detectRecurringPrices,type DetectedRecurringPrice} from './recurring-prices.ts';
import {detectionMonthsBefore,planRecurringDetection,applyRecurringDetectionPlan} from './recurring-detection.ts';
import {planRecurringRepairs,type RecurringRepairDetail} from './recurring-repair.ts';
export const MAINTENANCE_MODES=['generate','history','refresh','pipeline'] as const;
export interface RecurringMaintenanceOptions {asOf:string;mode:typeof MAINTENANCE_MODES[number];recurringEntryId?:string;useAllActive?:boolean;protectThrough?:string;backfill?:boolean;}
const FIRST='1900-01-01',LAST='2199-12-31',cap=(date:string)=>date<FIRST?FIRST:date>LAST?LAST:date;
const boundedDays=(date:string,count:number)=>new Date(Math.max(Date.parse(FIRST),Math.min(Date.parse(LAST),Date.parse(date)+count*86400000))).toISOString().slice(0,10);
const days=(a:string,b:string)=>(Date.parse(a)-Date.parse(b))/86400000;
const rulesOf=(entry:RecurringEntry)=>entry.rules.length?entry.rules:[{frequency:'monthly',interval:1}];
const longest=(entry:RecurringEntry)=>Math.max(...rulesOf(entry).map(r=>(r.frequency==='weekly'?7:r.frequency==='monthly'?31:366)*r.interval))+40;
const frequency=(entry:RecurringEntry)=>rulesOf(entry).reduce((n,r)=>n+(r.frequency==='weekly'?365.25/7:r.frequency==='monthly'?12:1)/r.interval,0);
export function nextPhaseOccurrence(entry:RecurringEntry,date:string){
 const window=longest(entry),limit=boundedDays(date,3660);let cursor=boundedDays(date,1);if(cursor<=date)return null;
 while(cursor<=limit){const end=boundedDays(cursor,window),pair=schedulePhasePairs(entry,cursor,end)[0];if(pair)return pair.dueOn;if(end===LAST||entry.endMode==='on_date'&&entry.endOn&&entry.endOn<end)return null;cursor=addDays(end,1);}
 return null;
}
export function recurringCycle(entry:RecurringEntry,date:string){const window=longest(entry),from=boundedDays(date,-window*2),past=schedulePhasePairs(entry,from,date),start=past.at(-1)?.dueOn??nextPhaseOccurrence(entry,boundedDays(from,-1));if(!start)return null;const end=nextPhaseOccurrence(entry,start);return end?{start,end}:null;}
export function generationWindow(entry:RecurringEntry,asOf:string){
 const cycle=recurringCycle(entry,asOf);let from=cycle?.start??asOf;if(entry.manual!==0)from=[from,entry.anchorDate,entry.startsOn].sort().at(-1)!;else if(entry.startsOn>entry.anchorDate)from=[from,entry.startsOn].sort().at(-1)!;
 const next=nextPhaseOccurrence(entry,asOf),minimum=boundedDays(asOf,90);let through=[minimum,next??minimum].sort().at(-1)!,clipped=false;
 if(entry.endMode==='after_count'&&entry.endAfterCount){const estimateDays=Math.ceil(365.25/frequency(entry))*(entry.endAfterCount+1),estimate=boundedDays(entry.anchorDate,estimateDays);if(Date.parse(entry.anchorDate)+estimateDays*86400000>Date.parse(LAST))clipped=true;through=[through,estimate].sort().at(-1)!;
  // A skipped weekend can leave the average-rate estimate short of a finite plan.
  let target=schedulePhasePairs(entry,FIRST,through).length,span=Math.max(90,Math.ceil(days(through,entry.anchorDate)));
  while(target<entry.endAfterCount&&through<LAST){span*=2;through=boundedDays(entry.anchorDate,span);target=schedulePhasePairs(entry,FIRST,through).length;}
  clipped=target<entry.endAfterCount;
 }
 return {from,through,cycle,next,clipped};
}
export function materializeRecurringWindow(entry:RecurringEntry,stored:RecurringOccurrence[],from:string,through:string){
 if(entry.status!=='active'||from>through)return [];
 const own=stored.filter(o=>o.recurringEntryId===entry.id),existing=new Set(own.map(o=>o.originalDueOn)),reach=recurrenceHalfCycle(entry),nearFrom=boundedDays(from,-reach),nearTo=boundedDays(through,reach),nearby=schedulePhasePairs(entry,nearFrom,nearTo),current=new Set(nearby.map(p=>p.originalDueOn)),firstByDue=new Map<string,typeof nearby[number]>();
 for(const pair of nearby)if(!firstByDue.has(pair.dueOn))firstByDue.set(pair.dueOn,pair);const dates=[...firstByDue.keys()].sort(),stoodIn=new Set<string>();
 for(const o of own){if(o.dueOn<nearFrom||o.dueOn>nearTo||current.has(o.originalDueOn))continue;let low=0,high=dates.length;while(low<high){const mid=Math.floor((low+high)/2);if(dates[mid]<o.dueOn)low=mid+1;else high=mid;}const closest=[dates[low-1],dates[low]].filter((d):d is string=>!!d).map(d=>firstByDue.get(d)!).filter(p=>Math.abs(days(p.dueOn,o.dueOn))<=reach).sort((a,b)=>Math.abs(days(a.dueOn,o.dueOn))-Math.abs(days(b.dueOn,o.dueOn))||a.dueOn.localeCompare(b.dueOn))[0];if(closest)stoodIn.add(closest.originalDueOn);}
 return schedulePhasePairs(entry,from,through).filter(p=>!existing.has(p.originalDueOn)&&!stoodIn.has(p.originalDueOn)).map<RecurringOccurrence>(pair=>({...pair,id:`generated:${entry.id}:${pair.originalDueOn}`,ownerId:entry.ownerId,recurringEntryId:entry.id,currency:entry.currency,expectedAmount:null,status:'scheduled',snoozedUntil:null,closedAt:null,closedSource:null,notes:''}));
}
export function planRecurringMaintenance(state:FinanceState,options:RecurringMaintenanceOptions){
 const {asOf,mode}=options,protectThrough=options.protectThrough??asOf;if(!validDate(asOf)||!validDate(protectThrough)||protectThrough<asOf)throw new Error('Choose valid recurring review and protection dates.');if(options.recurringEntryId&&!state.recurringEntries.some(e=>e.id===options.recurringEntryId&&e.status==='active'))throw new Error('Select an active recurring schedule.');
 if(mode==='pipeline'&&options.recurringEntryId)throw new Error('The combined recurring pipeline reviews the whole workspace. Choose all active schedules.');
 let next=structuredClone(state),sequence=0;const stages:string[]=[],repairDetails:RecurringRepairDetail[]=[],issues:string[]=[];let detection:null|{patternCount:number;created:number;updated:number;covered:number;futureSources:number;excludedSources:number}=null,repairCounts={orphans:0,repaired:0,unresolved:0};
 if(mode==='pipeline'){const plan=planRecurringDetection(next,{asOf}),applied=applyRecurringDetectionPlan(next,plan,protectThrough,()=>`pipeline-entry:${sequence++}`);next=applied.next;detection={patternCount:plan.patternCount,created:applied.applied.filter(r=>r.operation==='create').length,updated:applied.applied.filter(r=>r.operation!=='create').length,covered:plan.covered.length,futureSources:plan.futureSourceCount,excludedSources:plan.excludedSourceCount};stages.push('discovery');}
 const scope=next.recurringEntries.filter(e=>e.status==='active'&&(!options.recurringEntryId||e.id===options.recurringEntryId)),windows=scope.map(entry=>({recurringEntryId:entry.id,name:entry.name,...generationWindow(entry,asOf)})),matches:RecurringMatchCandidate[]=[],prices:DetectedRecurringPrice[]=[],pruned:RecurringOccurrence[]=[];let generated=0;
 const append=(entry:RecurringEntry,from:string,through:string)=>{const rows=materializeRecurringWindow(entry,next.recurringOccurrences,from,through);generated+=rows.length;if(next.recurringOccurrences.length+rows.length>20000)throw new Error('This review exceeds 20,000 materialized occurrences. Review one schedule or reduce obsolete history.');next.recurringOccurrences.push(...rows);};
 for(const window of windows){const entry=scope.find(e=>e.id===window.recurringEntryId)!;append(entry,window.from,window.through);if(window.clipped)issues.push(`${entry.name}: the finite plan extends beyond the supported calendar.`);}
 stages.push('generation');
 if(mode==='pipeline'){const repair=planRecurringRepairs(next);next=repair.next;repairDetails.push(...repair.details);issues.push(...repair.issues);repairCounts={orphans:repair.orphanCount,repaired:repair.details.length,unresolved:repair.unresolved};stages.push('repair');}
 const runMatching=(writeMode:'live'|'backfill')=>{
  const matchingState={...next,recurringEntries:next.recurringEntries.map(e=>options.useAllActive&&e.status==='active'?{...e,matching:{...(e.matching??matcherDefaults()),enabled:true}}:e)},entries=new Map(matchingState.recurringEntries.map(e=>[e.id,e])),eligible=matchingState.recurringOccurrences.filter(o=>o.status==='scheduled'&&entries.get(o.recurringEntryId)?.status==='active'&&entries.get(o.recurringEntryId)?.matching?.enabled);
  if(!eligible.length)return;
  const windows=eligible.map(o=>matcherWindow(entries.get(o.recurringEntryId)!,o,matchingState,asOf)),from=cap(windows.reduce((min,w)=>w.start<min?w.start:min,asOf)),to=writeMode==='live'?asOf:cap(windows.reduce((max,w)=>w.end>max?w.end:max,asOf)),plan=planRecurringMatches(matchingState,{from,to,asOf,writeMode,storedOnly:true,includeFuture:writeMode==='backfill'});
  matches.push(...plan.rows);const applied=applyRecurringMatchPlan(matchingState,plan.rows,state.profile?.ownerId??'',{id:()=>`maintenance-allocation:${sequence++}`,timestamp:asOf+'T00:00:00.000Z'});next={...applied,recurringEntries:next.recurringEntries};
 };
 if(mode==='refresh'||mode==='pipeline'){
  runMatching('live');stages.push('live_matching');prices.push(...detectRecurringPrices(next,asOf,undefined,true));
  for(const price of prices){next.recurringPriceChanges.push({id:`maintenance-price:${sequence++}`,ownerId:state.profile?.ownerId??'',recurringEntryId:price.recurringEntryId,effectiveOn:price.effectiveOn,previousAmount:price.previousAmount,newAmount:price.newAmount,currency:price.currency,source:'detected',transactionId:price.transactionId});const entry=next.recurringEntries.find(e=>e.id===price.recurringEntryId)!;
   if(entry.manual===0){for(const o of next.recurringOccurrences)if(o.recurringEntryId===entry.id&&o.status==='scheduled'&&o.expectedAmount===null&&o.dueOn<=protectThrough)o.expectedAmount=expectedOccurrenceAmount(entry,o,next.recurringOccurrences,next.recurringAllocations);entry.amount=-price.newAmount;}
  }
  stages.push('price_observation');
 }
 if(mode==='history'||mode==='pipeline'&&options.backfill!==false){
  const from=cap(detectionMonthsBefore(asOf,6));for(const entry of scope)append(entry,from,asOf);
  runMatching('backfill');const allocated=new Set(next.recurringAllocations.map(a=>a.occurrenceId)),cycles=new Map(windows.map(w=>[w.recurringEntryId,w.cycle?.start??null])),originalIds=new Set(state.recurringOccurrences.map(o=>o.id)),intents=new Map(scope.map(e=>[e.id,e.manual!==0?[e.anchorDate,e.startsOn].sort().at(-1)!:e.startsOn>e.anchorDate?e.startsOn:null]));
  next.recurringOccurrences=next.recurringOccurrences.filter(o=>{const start=cycles.get(o.recurringEntryId),intent=intents.get(o.recurringEntryId),beforeIntent=!!intent&&!originalIds.has(o.id)&&o.dueOn<intent;if((start&&o.dueOn<start||beforeIntent)&&o.status==='scheduled'&&!allocated.has(o.id)){pruned.push(o);return false;}return true;});
  stages.push('history');
  for(const window of windows)if(!window.cycle)issues.push(`${window.name}: there is no bounded current cycle; uncovered historical reminders are retained for review.`);
 }
 const completedScope=new Set(scope.map(e=>e.id));if(mode==='history'||mode==='pipeline'&&options.backfill!==false)next.recurringEntries=next.recurringEntries.map(e=>completedScope.has(e.id)?completeActivationHistory(withRecurringHistoryFloor(e,windows.find(w=>w.recurringEntryId===e.id)?.cycle?.start??null),asOf):e);
 const beforeOccurrences=new Set(state.recurringOccurrences.map(o=>o.id)),changes=recurringStateChanges(state,next);
 if(next.recurringPriceChanges.length>5000)throw new Error('Price history is limited to 5,000 records.');
 return {options:{...options,useAllActive:!!options.useAllActive,protectThrough,...(mode==='pipeline'?{backfill:options.backfill!==false}:{})},stages,detection,repairCounts,repairDetails,revision:state.profile?.revision??0,windows,generated,discardedUncovered:pruned.length,discardedVirtual:pruned.filter(o=>!beforeOccurrences.has(o.id)).length,matches,prices,issues,changes,next,futureMatched:changes.allocations.filter(a=>a.paidOn!>asOf).length};
}
export const MAINTENANCE_SECTIONS=['created','updated','removed','allocations','prices','repriced','schedulesCreated','schedulesUpdated','repaired'] as const;
export function recurringMaintenancePage(report:ReturnType<typeof planRecurringMaintenance>,section:typeof MAINTENANCE_SECTIONS[number]='created',offset=0){const rows=report.changes[section];if(!Number.isInteger(offset)||offset<0||offset>20000||offset>0&&offset>=rows.length)throw new Error('Choose an available recurring maintenance page.');const {changes,matches}=report,summary={options:report.options,stages:report.stages,detection:report.detection,repairCounts:report.repairCounts,repairDetails:section==='repaired'?report.repairDetails.filter(d=>(rows.slice(offset,offset+25) as {id:string}[]).some(r=>r.id===d.allocationId)):[],revision:report.revision,windows:report.windows,generated:report.generated,discardedUncovered:report.discardedUncovered,discardedVirtual:report.discardedVirtual,issues:report.issues,futureMatched:report.futureMatched};return {...summary,counts:Object.fromEntries(MAINTENANCE_SECTIONS.map(key=>[key,changes[key].length])),matchCounts:{confirmed:matches.filter(m=>m.tier==='confirmed').length,suggested:matches.filter(m=>m.tier==='suggested').length},section,page:{offset,limit:25,total:rows.length,rows:rows.slice(offset,offset+25)}};}
