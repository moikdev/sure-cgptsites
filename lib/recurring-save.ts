import {recurringHistoryFloor} from './recurring-history.ts';
import {validDate,type FinanceState,type RecurringEntry} from './finance.ts';import {schedulePairs,expectedOccurrenceAmount,validateRecurringEntry} from './recurring.ts';
import {generationWindow,materializeRecurringWindow,planRecurringMaintenance} from './recurring-maintenance.ts';import {recurringStateChanges} from './recurring-state.ts';import {activationHistoryWork,setActivationHistoryWork} from './recurring-work.ts';import {validateWorkspace} from './workspace.ts';
const shapeKeys=['anchorDate','startsOn','expectedDayOfMonth','rules','endMode','endOn','endAfterCount','weekendAdjust','status','currency'] as const;
export function planRecurringSave(state:FinanceState,input:RecurringEntry,asOf:string){
 if(!validDate(asOf))throw new Error('Choose a valid schedule save date.');validateRecurringEntry(input);const previous=state.recurringEntries.find(e=>e.id===input.id),activated=previous?.status==='suggested'&&input.status==='active',issues:string[]=[],stages:string[]=[];let next=structuredClone(state),entry=structuredClone(input),generated=0,historyMatched=0,historyFutureMatched=0,historyPruned=0,historyAttempted=false,historyCompleted=false;
 if(previous&&previous.status!=='active'&&entry.status==='active'){
  if(activated&&entry.manual===0)entry.startsOn=[entry.startsOn,entry.anchorDate].sort()[0];
  else entry.startsOn=[asOf,entry.startsOn].sort().at(-1)!;
 }
 if(!previous){entry.lastOccurrenceOn=entry.lastOccurrenceOn??entry.anchorDate;entry.occurrenceCount=entry.occurrenceCount??0;}
 const allocated=new Set(state.recurringAllocations.map(a=>a.occurrenceId)),own=state.recurringOccurrences.filter(o=>o.recurringEntryId===entry.id);
 if(previous&&previous.currency!==entry.currency&&(own.some(o=>o.status!=='scheduled'||allocated.has(o.id)||o.dueOn<=asOf)||previous.status==='active'&&schedulePairs(previous,previous.startsOn,asOf).some(p=>p.dueOn<=asOf)))throw new Error('A schedule with payment, closed or already-due history cannot change currency.');
 // Earlier virtual obligations were already visible before this edit; pin their original estimates.
 if(previous?.status==='active'){
  const from=[previous.anchorDate,previous.startsOn,recurringHistoryFloor(previous)??'1900-01-01'].sort().at(-1)!;for(const o of materializeRecurringWindow(previous,next.recurringOccurrences,from,asOf)){o.expectedAmount=expectedOccurrenceAmount(previous,o,state.recurringOccurrences,state.recurringAllocations);next.recurringOccurrences.push(o);}
 }
 if(previous&&previous.currency!==entry.currency)next.recurringOccurrences=next.recurringOccurrences.filter(o=>o.recurringEntryId!==entry.id);
 next.recurringEntries=next.recurringEntries.filter(e=>e.id!==entry.id).concat(entry);validateWorkspace({...next,budgets:[]});
 const historyPending=activationHistoryWork(entry)?.status==='pending';
 if(entry.status==='active'&&(activated||historyPending)){
  historyAttempted=true;stages.push('activation_history');
  try{const report=planRecurringMaintenance(next,{mode:'history',asOf,protectThrough:asOf,recurringEntryId:entry.id});validateWorkspace({...report.next,budgets:[]});next=report.next;generated+=report.generated;historyMatched=report.changes.allocations.length;historyFutureMatched=report.futureMatched;historyPruned=report.changes.removed.length;issues.push(...report.issues);entry=setActivationHistoryWork(next.recurringEntries.find(e=>e.id===entry.id)!,{version:1,status:'complete',requestedOn:activationHistoryWork(entry)?.requestedOn??asOf,completedOn:asOf});historyCompleted=true;}
  catch(error){const message=error instanceof Error?error.message:'History reconstruction needs review.';entry=setActivationHistoryWork(entry,{version:1,status:'pending',requestedOn:activationHistoryWork(entry)?.requestedOn??asOf,error:message.slice(0,500)});issues.push('Schedule activation is saved; history remains pending. Open Recurring review to finish it. '+message);}
  next.recurringEntries=next.recurringEntries.filter(e=>e.id!==entry.id).concat(entry);
 }else if(historyPending&&entry.status!=='active'){entry=setActivationHistoryWork(entry,{version:1,status:'cancelled',requestedOn:activationHistoryWork(entry)!.requestedOn});next.recurringEntries=next.recurringEntries.filter(e=>e.id!==entry.id).concat(entry);}
 const changed=!!previous&&shapeKeys.some(key=>JSON.stringify(previous[key])!==JSON.stringify(entry[key]));
 if(changed){const paid=new Set(next.recurringAllocations.map(a=>a.occurrenceId));next.recurringOccurrences=next.recurringOccurrences.filter(o=>o.recurringEntryId!==entry.id||o.status!=='scheduled'||o.dueOn<asOf||paid.has(o.id));stages.push('regenerate_future');}
 if(!previous||changed||historyAttempted){const window=generationWindow(entry,asOf),rows=materializeRecurringWindow(entry,next.recurringOccurrences,window.from,window.through);next.recurringOccurrences.push(...rows);generated+=rows.length;if(window.clipped)issues.push('The finite plan extends beyond the supported calendar.');stages.push('generation');}
 // Preserve estimates due today after regeneration too, matching the source callback ordering.
 if(previous&&(previous.amount!==entry.amount||previous.amountStrategy!==entry.amountStrategy||previous.expectedAmountAvg!==entry.expectedAmountAvg))for(const o of next.recurringOccurrences)if(o.recurringEntryId===entry.id&&o.status==='scheduled'&&o.expectedAmount===null&&o.dueOn<=asOf)o.expectedAmount=expectedOccurrenceAmount(previous,o,state.recurringOccurrences,state.recurringAllocations);
 validateWorkspace({...next,budgets:[]});return {next,changes:recurringStateChanges(state,next),stages,generated,activated,historyAttempted,historyCompleted,historyMatched,historyFutureMatched,historyPruned,issues};
}
