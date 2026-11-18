import {ApiError,readState,database,commitMutation} from './repository';
import {transferMatchSchema} from './transfer-match-schema';
import {planTransferMatch} from './transfer-match';
import {fxColumns,fxValues} from './fx-persistence';
import {validateWorkspace} from './workspace';
export async function executeTransferMatch(owner:string,input:unknown,revision:number){
  const parsed=transferMatchSchema.safeParse(input);if(!parsed.success)return null;
  const c=parsed.data;if(c.operation==='unlink'&&c.counterpartId!==undefined)throw new ApiError(400,'Unlink uses the existing transfer counterpart.');const state=await readState(owner);
  if(state.profile?.revision!==revision||c.expectedRevision!==undefined&&c.expectedRevision!==revision)throw new ApiError(409,'Your workspace changed. Review the transfer again.');
  if(!state.transactions.some(t=>t.id===c.transactionId)||c.counterpartId&&!state.transactions.some(t=>t.id===c.counterpartId))throw new ApiError(404,'Transaction not found.');
  let plan;try{plan=planTransferMatch(state,c,undefined,crypto.randomUUID());validateWorkspace({...plan.next,budgets:[]});}catch(error){throw new ApiError(400,error instanceof Error?error.message:'These transactions could not be linked.');}
  const {review,next,detail,transferId}=plan,content=JSON.stringify(['transfer-match-v1',owner,revision,review]),receipt=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(c.mode==='preview')return {...review,expectedRevision:revision,receipt};
  if(c.expectedRevision!==revision||c.receipt!==receipt||c.reviewedOn!==review.reviewedOn)throw new ApiError(409,'The entries, date or workspace changed. Review the transfer again.');
  const db=database(),statements:D1PreparedStatement[]=[];
  if(detail){const columns=fxColumns('transferDetails');statements.push(db.prepare(`INSERT INTO transfer_details (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...fxValues('transferDetails',detail)));}
  for(const leg of review.legs){const row=next.transactions.find(t=>t.id===leg.id)!;statements.push(db.prepare('UPDATE transactions SET transfer_id=?,kind=?,locked_fields=? WHERE owner_id=? AND id=?').bind(row.transferId,row.kind,JSON.stringify(row.lockedFields??[]),owner,row.id));}
  if(c.operation==='unlink')statements.push(db.prepare('DELETE FROM transfer_fees WHERE owner_id=? AND transfer_id=?').bind(owner,transferId),db.prepare('DELETE FROM transfer_details WHERE owner_id=? AND id=?').bind(owner,transferId));
  // A link alone can change principal-only loan replay even when kinds were already correct.
  for(const leg of review.legs)statements.push(db.prepare('UPDATE account_statements SET review_required=1 WHERE owner_id=? AND account_id=? AND period_end>=? AND completed_at IS NOT NULL').bind(owner,leg.accountId,leg.date));
  await commitMutation(owner,revision,statements,28);
  return {message:c.operation==='link'?'Existing entries linked as a transfer. IDs, dates, native amounts, labels and receipts are preserved.':'Transfer unlinked. Both entries are now standard transactions; original receipts and any fee expenses are preserved.'};
}
