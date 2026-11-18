import {taxAdvantaged} from './account-details';
import {ApiError,commitMutation,database,readState} from './repository';
import {paycheckCommandSchema} from './paycheck-schema';
export async function executePaycheckPreference(owner:string,input:unknown,revision:number){
 const parsed=paycheckCommandSchema.safeParse(input);if(!parsed.success)return null;const c=parsed.data,state=await readState(owner);
 if(state.profile?.revision!==revision||c.expectedRevision!==revision)throw new ApiError(409,'Your workspace changed. Reload the income plan before changing its inputs.');
 if(c.action==='declareRecurringIncome'){
  const entry=state.recurringEntries.find(e=>e.id===c.recurringEntryId);if(!entry)throw new ApiError(404,'Income schedule not found.');if(entry.billType!=='income')throw new ApiError(400,'Only income schedules can define paydays.');if(entry.manual===1)return {message:'This income schedule is already declared.'};
  await commitMutation(owner,revision,[database().prepare('UPDATE recurring_entries SET manual=1 WHERE owner_id=? AND id=?').bind(owner,entry.id)],20);
  return {message:'Income declared. Active unpaid upcoming occurrences can define paydays; no transactions were created.'};
 }
 const account=state.accounts.find(a=>a.id===c.accountId);if(!account)throw new ApiError(404,'Cash account not found.');if(!['checking','savings'].includes(account.type))throw new ApiError(400,'Cash planning uses checking and savings accounts.');
 if(!c.excluded&&taxAdvantaged(account))throw new ApiError(400,'Tax-advantaged accounts are excluded from payday cash. Correct the account subtype if it was recorded incorrectly.');
 if(account.cashPlanningExcluded===Number(c.excluded))return {message:'This cash-planning choice is unchanged.'};
 await commitMutation(owner,revision,[database().prepare('UPDATE accounts SET cash_planning_excluded=? WHERE owner_id=? AND id=?').bind(Number(c.excluded),owner,account.id)],20);
 return {message:c.excluded?'Account excluded from cash before payday. Its recorded balance is unchanged.':'Account included in cash before payday when active and visible in reports.'};
}
