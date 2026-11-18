import {ApiError,commitMutation,database,readState} from './repository';
import {transferRejectionSchema} from './transfer-rejection-schema';
import {transferHintPairs,transferPairKey} from './transfer-hints';
import {transferMatchCandidates} from './transfer-match';
import {transferRejectionColumns,transferRejectionValues} from './transfer-rejection-persistence';
import {validateWorkspace} from './workspace';
export async function executeTransferRejection(owner:string,input:unknown,revision:number){
  const parsed=transferRejectionSchema.safeParse(input);if(!parsed.success)return null;const c=parsed.data,state=await readState(owner),db=database();
  if(state.profile?.revision!==revision||c.expectedRevision!==revision)throw new ApiError(409,'Your workspace changed. Review the transfer suggestions again.');
  if(c.event==='clear'){
    if(!c.id||c.transactionId||c.counterpartId)throw new ApiError(400,'Choose one saved transfer dismissal to clear.');
    if(!state.transferMatchRejections.some(r=>r.id===c.id))throw new ApiError(404,'Transfer dismissal not found.');
    await commitMutation(owner,revision,[db.prepare('DELETE FROM transfer_match_rejections WHERE owner_id=? AND id=?').bind(owner,c.id)],20);return {message:'Transfer dismissal cleared. This pair can appear as a suggestion again.'};
  }
  if(!c.transactionId||c.id||c.event==='dismiss_hints'&&c.counterpartId)throw new ApiError(400,'Choose the transaction and supported dismissal options.');
  const t=state.transactions.find(t=>t.id===c.transactionId);if(!t||c.counterpartId&&!state.transactions.some(t=>t.id===c.counterpartId))throw new ApiError(404,'Transaction not found.');
  let pairs;
  if(c.event==='dismiss_hints')pairs=transferHintPairs(state,[t.id]);
  else{
    const other=state.transactions.find(t=>t.id===c.counterpartId);if(!other)throw new ApiError(400,'Choose a counterpart to dismiss.');
    if(!transferMatchCandidates(state,t.id).some(row=>row.transactionId===other.id))throw new ApiError(400,'Choose an available existing transfer counterpart.');
    pairs=[{outflowTransactionId:t.amount<0?t.id:other.id,inflowTransactionId:t.amount>0?t.id:other.id}];
  }
  const known=new Set(state.transferMatchRejections.map(r=>transferPairKey(r.outflowTransactionId,r.inflowTransactionId))),stamp=new Date().toISOString(),rows=pairs.filter(p=>!known.has(transferPairKey(p.outflowTransactionId,p.inflowTransactionId))).map(p=>({...p,id:crypto.randomUUID(),ownerId:owner,createdAt:stamp,updatedAt:stamp}));
  if(!rows.length)return {message:'No new transfer suggestions to dismiss. Existing decisions are unchanged.',dismissed:0};
  try{validateWorkspace({...state,transferMatchRejections:state.transferMatchRejections.concat(rows),budgets:[]});}catch(error){throw new ApiError(400,error instanceof Error?error.message:'These suggestions could not be dismissed.');}
  const statements:D1PreparedStatement[]=[];for(let i=0;i<rows.length;i+=16){const batch=rows.slice(i,i+16);statements.push(db.prepare(`INSERT INTO transfer_match_rejections (${transferRejectionColumns.join(',')}) VALUES ${batch.map(()=>'(?,?,?,?,?,?)').join(',')}`).bind(...batch.flatMap(transferRejectionValues)));}
  await commitMutation(owner,revision,statements,20);return {message:`Dismissed ${rows.length} transfer suggestion(s). Recorded money and reporting are unchanged; manual matching remains available.`,dismissed:rows.length};
}
