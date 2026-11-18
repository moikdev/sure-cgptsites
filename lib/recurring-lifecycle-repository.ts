import {activationHistoryWork} from './recurring-work';
import {ApiError,commitMutation,database,readState} from './repository';
import {executeLedgerCommand} from './ledger-repository';
import {recurringLifecycleCommandSchema,lifecycleKeys} from './recurring-lifecycle-schema';
export async function executeRecurringLifecycle(owner:string,input:unknown,revision:number){
 const parsed=recurringLifecycleCommandSchema.safeParse(input);if(!parsed.success)return null;const c=parsed.data,state=await readState(owner);
 if(state.profile?.revision!==revision||c.expectedRevision!==revision)throw new ApiError(409,'Your workspace changed. Reload lifecycle details before saving.');
 const entry=state.recurringEntries.find(e=>e.id===c.recurringEntryId);if(!entry)throw new ApiError(404,'Recurring schedule not found.');
 if(c.action==='recurringHistoryRetry'){if(entry.status!=='active')throw new ApiError(400,'Activate the schedule before reconstructing history.');if(activationHistoryWork(entry)?.status!=='pending')return {message:'This schedule has no pending activation history.'};return executeLedgerCommand(owner,{...entry,action:'recurring'},revision);}
 if(c.action==='recurringStatus'){
  const status=c.event==='pause'?'paused':c.event==='resume'?'active':'ended';if(entry.status===status)return {message:'This schedule already has that status.'};
  const result=await executeLedgerCommand(owner,{...entry,action:'recurring',status},revision);return {...result,message:(status==='active'?(entry.status==='suggested'?'Suggestion activated.':'Schedule resumed. New reminders start from today; earlier records are retained.'):status==='paused'?'Schedule paused. Payment history and earlier unpaid obligations are retained.':'Schedule ended. Its records are retained; it no longer participates in matching.')+' '+(result?.message??'')};
 }
 if(lifecycleKeys.every(key=>(entry[key]??null)===c[key]))return {message:'Lifecycle dates are unchanged.'};
 await commitMutation(owner,revision,[database().prepare('UPDATE recurring_entries SET renews_on=?,trial_ends_on=?,cancelled_on=? WHERE owner_id=? AND id=?').bind(c.renewsOn,c.trialEndsOn,c.cancelledOn,owner,entry.id)],20);
 return {message:c.cancelledOn&&entry.status==='active'?'Dates saved. This cancellation record leaves the schedule active; pause or end it to stop new reminders.':'Lifecycle dates saved. The schedule and payments are unchanged.'};
}
