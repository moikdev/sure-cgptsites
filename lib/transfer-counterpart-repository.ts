import {ApiError,readState,database,commitMutation,insertTransaction} from './repository';
import {transferCounterpartSchema} from './transfer-counterpart-schema';
import {normalizeTransferCounterpart,planTransferCounterpart,transferCounterpartPage} from './transfer-counterpart';
import {fxColumns,fxValues} from './fx-persistence';
import {validateWorkspace} from './workspace';
const digest=async(input:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(input))))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function executeTransferCounterpart(owner:string,input:unknown,revision:number){
  const parsed=transferCounterpartSchema.safeParse(input);if(!parsed.success)return null;const c=parsed.data,state=await readState(owner);
  if(!state.transactions.some(t=>t.id===c.transactionId)||!state.accounts.some(a=>a.id===c.targetAccountId))throw new ApiError(404,'Transaction or target account not found.');
  let normalized;try{normalized=normalizeTransferCounterpart(state,c).normalized;}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Choose valid missing-entry details.');}
  const fingerprint=await digest(['transfer-counterpart-v1',owner,normalized]),prior=state.transferDetails.find(d=>d.requestId===c.requestId);
  if(prior){
    const original=state.transactions.find(t=>t.id===c.transactionId),counterpart=state.transactions.find(t=>t.transferId===prior.id&&t.id!==c.transactionId);
    if(prior.requestFingerprint!==fingerprint||original?.transferId!==prior.id||!counterpart||counterpart.accountId!==c.targetAccountId||counterpart.date!==normalized.counterpartDate||Math.abs(counterpart.amount)!==normalized.counterpartAmount)throw new ApiError(409,'This creation request was already used for different transfer details. Start a new missing-entry review.');
    if(c.mode==='preview')throw new ApiError(409,'This missing entry was already created. Reload the transfer.');
    return {message:'This missing transfer entry was already created. No duplicate was added.',alreadyRecorded:true,transferId:prior.id,counterpartId:counterpart.id};
  }
  if(state.profile?.revision!==revision||c.expectedRevision!==undefined&&c.expectedRevision!==revision)throw new ApiError(409,'Your workspace changed. Review the missing entry again.');
  let plan,page;try{plan=planTransferCounterpart(state,c,undefined,crypto.randomUUID(),crypto.randomUUID());validateWorkspace({...plan.next,budgets:[]});page=transferCounterpartPage(plan.review,c.offset);}catch(error){throw new ApiError(400,error instanceof Error?error.message:'The missing entry could not be reviewed.');}
  const {review,detail,created,transferId}=plan,receipt=await digest(['transfer-counterpart-review-v1',owner,revision,fingerprint,review]);
  if(c.mode==='preview')return {...page,expectedRevision:revision,receipt};
  if(c.expectedRevision!==revision||c.receipt!==receipt||c.reviewedOn!==review.reviewedOn)throw new ApiError(409,'The entries, date or workspace changed. Review the missing entry again.');
  if(review.duplicateTotal&&!c.acknowledgeDuplicates)throw new ApiError(400,'Review the possible existing counterparts and confirm that a new entry is still needed.');
  const db=database(),columns=fxColumns('transferDetails'),snapshot={...detail!,requestId:c.requestId,requestFingerprint:fingerprint},original=plan.next.transactions.find(t=>t.id===c.transactionId)!;
  const statements=[db.prepare(`INSERT INTO transfer_details (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...fxValues('transferDetails',snapshot)),insertTransaction(owner,created),db.prepare('UPDATE transactions SET transfer_id=?,kind=? WHERE owner_id=? AND id=?').bind(transferId,original.kind,owner,original.id),...review.legs.map(leg=>db.prepare('UPDATE account_statements SET review_required=1 WHERE owner_id=? AND account_id=? AND period_end>=? AND completed_at IS NOT NULL').bind(owner,leg.accountId,leg.date))];
  await commitMutation(owner,revision,statements,20);
  return {message:'One missing transfer entry created and linked. The original entry, import key, labels and receipts are preserved.',transferId,counterpartId:created.id};
}
