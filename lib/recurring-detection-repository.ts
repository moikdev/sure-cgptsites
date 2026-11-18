import {ApiError,database,readState,commitMutation} from './repository';import {recurringDetectionCommandSchema} from './recurring-detection-schema';
import {planRecurringDetection,applyRecurringDetectionPlan} from './recurring-detection';import {recurringColumns,recurringValues} from './ledger-persistence';import {validateWorkspace} from './workspace';import {today} from './finance';
export async function executeRecurringDetection(owner:string,input:unknown,revision:number){
 const parsed=recurringDetectionCommandSchema.safeParse(input);if(!parsed.success)return null;const c=parsed.data,state=await readState(owner);if(state.profile?.revision!==revision||c.expectedRevision!==undefined&&c.expectedRevision!==revision)throw new ApiError(409,'Your workspace changed. Review recurring patterns again.');if(c.asOf>today())throw new ApiError(400,'Choose a detection date through today.');
 let plan;try{plan=planRecurringDetection(state,c);}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Recurring patterns could not be reviewed.');}
 if(c.offset&&c.offset>=plan.rows.length)throw new ApiError(400,'Choose an available detection page.');
 const content=JSON.stringify(['recurring-detection-v1',owner,revision,c.asOf,c.kind,plan.rows.map(row=>[row.operation,row.after])]),receipt=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const db=database(),statements:D1PreparedStatement[]=[];let issue:string|null=null;
 try{
  const applied=applyRecurringDetectionPlan(state,plan,today(),()=>crypto.randomUUID()),next=applied.next;
  for(const row of applied.applied){const after=row.after;
   if(row.before?.amountStrategy==='average'&&row.before.expectedAmountAvg!==after.expectedAmountAvg){const expected=row.before.expectedAmountAvg??Math.abs(row.before.amount);statements.push(db.prepare('UPDATE recurring_occurrences SET expected_amount=? WHERE owner_id=? AND recurring_entry_id=? AND expected_amount IS NULL AND due_on<=?').bind(expected,owner,after.id,today()));}
   if(row.before&&(row.before.expectedDayOfMonth!==after.expectedDayOfMonth||JSON.stringify(row.before.rules)!==JSON.stringify(after.rules))){statements.push(db.prepare("DELETE FROM recurring_occurrences WHERE owner_id=? AND recurring_entry_id=? AND status='scheduled' AND due_on>? AND NOT EXISTS (SELECT 1 FROM recurring_allocations WHERE owner_id=? AND occurrence_id=recurring_occurrences.id)").bind(owner,after.id,today(),owner));}
   if(row.operation==='create')statements.push(db.prepare(`INSERT INTO recurring_entries (${recurringColumns.join(',')}) VALUES (${recurringColumns.map(()=>'?').join(',')})`).bind(...recurringValues(after)));
   else statements.push(db.prepare(`UPDATE recurring_entries SET ${recurringColumns.slice(2).map(column=>column+'=?').join(',')} WHERE owner_id=? AND id=?`).bind(...recurringValues(after).slice(2),owner,after.id));
  }
  validateWorkspace({...next,budgets:[]});
 }catch(error){issue=error instanceof Error?error.message:'These recurring patterns cannot be saved.';}
 if(c.mode==='preview'){const {rows,covered,...summary}=plan;return {...summary,total:rows.length,offset:c.offset,limit:25,rows:rows.slice(c.offset,c.offset+25).map(row=>({...row,pattern:{...row.pattern,sources:row.pattern.sources.slice(0,25),sourceCount:row.pattern.sources.length}})),coveredCount:covered.length,covered:covered.slice(0,25).map(row=>({entryId:row.entryId,reason:row.reason,name:row.pattern.name})),counts:{create:rows.filter(r=>r.operation==='create').length,refresh:rows.filter(r=>r.operation==='refresh').length,manualVariance:rows.filter(r=>r.operation==='manual_variance').length},expectedRevision:revision,receipt,canCommit:c.kind==='automatic'&&!issue,issue};}
 if(c.kind!=='automatic')throw new ApiError(400,'Open a candidate in the schedule editor to choose its amount and cadence.');if(c.expectedRevision!==revision||c.receipt!==receipt)throw new ApiError(409,'The workspace or detection options changed. Preview again.');if(issue)throw new ApiError(400,issue);
 if(statements.length)await commitMutation(owner,revision,statements,20);
 return {message:`Saved ${plan.rows.filter(r=>r.operation==='create').length} suggested schedule(s) and refreshed ${plan.rows.filter(r=>r.operation!=='create').length} observation(s). Review suggestions before activating them. Ledger entries and balances are unchanged.`};
}
