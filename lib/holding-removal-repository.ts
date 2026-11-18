import {z} from 'zod';
import {ApiError,commitMutation,database,readState} from './repository';
import {today,validDate} from './finance';
import {csvDigest} from './csv-digest';
import {planHoldingRemoval,holdingRemovalPage,holdingRemovalCSVRows} from './holding-removal';
import {csvRowStream} from './monthly-breakdown';
const id=z.string().uuid(),date=z.string().refine(validDate),revision=z.number().int().safe().nonnegative(),receipt=z.string().regex(/^[a-f0-9]{64}$/),page=z.number().int().min(0).max(20000).multipleOf(25).default(0),scope={holdingId:id,asOf:date.optional()},stamp={expectedRevision:revision,receipt,reviewedOn:date};
export const holdingRemovalCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('review'),...scope,expectedRevision:revision.optional(),receipt:receipt.optional(),reviewedOn:date.optional(),offset:page,positionOffset:page,effectOffset:page,statementOffset:page}).strict(),
 z.object({action:z.literal('export'),...scope,...stamp}).strict(),
 z.object({action:z.literal('commit'),...scope,...stamp,confirmation:z.literal('REMOVE HOLDING AND TRADES')}).strict()
]).superRefine((c,ctx)=>{if(c.action==='review'){const guarded=c.expectedRevision!==undefined;if(guarded!==(c.receipt!==undefined)||guarded!==(c.reviewedOn!==undefined)||!guarded&&(c.offset||c.positionOffset||c.effectOffset||c.statementOffset))ctx.addIssue({code:'custom',message:'Use the current review receipt for page navigation.'});}});
export async function executeHoldingRemoval(owner:string,input:unknown){
 const c=holdingRemovalCommand.parse(input),state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');if(!state.holdingSnapshots.some(h=>h.id===c.holdingId))throw new ApiError(404,'This holding observation is unavailable. Reload the account before continuing.');let plan;try{plan=planHoldingRemoval(state,c.holdingId,c.asOf??today());}catch(e){throw new ApiError(400,(e as Error).message);}
 const expected=await csvDigest(JSON.stringify(['holding-removal-v1',owner,state.profile.revision,c.holdingId,plan.asOf,plan.reviewedOn]));if(c.expectedRevision!==undefined&&(c.expectedRevision!==state.profile.revision||c.receipt!==expected||c.reviewedOn!==plan.reviewedOn))throw new ApiError(409,'The workspace, holding, valuation date or review date changed. Review the complete removal again.');
 if(c.action==='export')return new Response(csvRowStream(holdingRemovalCSVRows(plan,state.profile.revision,expected)),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':`attachment; filename="sure-holding-removal-${plan.holding.id}.csv"`}});
 if(c.action==='review'){try{return {...holdingRemovalPage(plan,c.offset,c.positionOffset,c.effectOffset,c.statementOffset),expectedRevision:state.profile.revision,receipt:expected};}catch(e){throw new ApiError(400,(e as Error).message);}}
 const db=database(),statements=[db.prepare('DELETE FROM trades WHERE owner_id=? AND account_id=? AND security_id=?').bind(owner,plan.account.id,plan.security.id),db.prepare('DELETE FROM holding_snapshots WHERE owner_id=? AND id=?').bind(owner,plan.holding.id)];
 for(const statement of plan.statements)statements.push(db.prepare('UPDATE account_statements SET review_required=1 WHERE owner_id=? AND id=? AND completed_at IS NOT NULL').bind(owner,statement.id));
 await commitMutation(owner,state.profile.revision,statements,6,{guardId:'holding-removal:'+crypto.randomUUID()});return {message:`Removed the holding observation and ${plan.trades.length} related trades from ${plan.account.name}. Other dated observations and financial records remain. Reload the account to inspect its resulting history.`,removedHoldingId:plan.holding.id,removedTrades:plan.trades.length};
}
