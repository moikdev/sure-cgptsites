import {z} from 'zod';
import {ApiError,commitMutation,readState} from './repository';
import {budgetChangeStatements} from './budget-repository';
import {planBudgetCopy,budgetCopyPage} from './budget-copy';
import {csvDigest} from './csv-digest';
import {ledgerDate} from './ledger-schema';
const fields={sourceId:z.string().uuid(),targetId:z.string().uuid(),date:ledgerDate},page=z.number().int().min(0).max(40000).multipleOf(25).default(0);
const command=z.discriminatedUnion('action',[z.object({action:z.literal('preview'),...fields,offset:page,effectOffset:page}).strict(),z.object({action:z.literal('commit'),...fields,expectedRevision:z.number().int().safe().nonnegative(),receipt:z.string().regex(/^[a-f0-9]{64}$/),reviewedOn:ledgerDate,confirmation:z.literal('COPY PLAN')}).strict()]);
export async function executeBudgetCopy(owner:string,input:unknown){
 const c=command.parse(input),state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');
 if(c.action==='commit'&&c.expectedRevision!==state.profile.revision)throw new ApiError(409,'Your workspace changed. Review the complete plan again.');
 if(!state.budgetPeriods.some(p=>p.id===c.sourceId)||!state.budgetPeriods.some(p=>p.id===c.targetId))throw new ApiError(404,'Budget period not found.');
 let plan;try{plan=await planBudgetCopy(state,{sourceId:c.sourceId,targetId:c.targetId,date:c.date});}catch(e){throw new ApiError(400,(e as Error).message);}
 const receipt=await csvDigest(JSON.stringify(['budget-copy-review-v1',owner,state.profile.revision,c.sourceId,c.targetId,c.date,plan.reviewedOn,plan.quote]));
 if(c.action==='preview')return {...budgetCopyPage(plan,c.offset,c.effectOffset),receipt,expectedRevision:state.profile.revision};
 if(c.receipt!==receipt||c.expectedRevision!==state.profile.revision||c.reviewedOn!==plan.reviewedOn)throw new ApiError(409,'Your workspace, conversion choice or review date changed. Review the complete plan again.');
 await commitMutation(owner,state.profile.revision,budgetChangeStatements(owner,state,plan.next));
 return {message:'Budget plan copied with the reviewed conversion. Account balances are unchanged.'};
}
