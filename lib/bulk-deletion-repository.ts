import {z} from 'zod';
import {ApiError,commitMutation,database,readState} from './repository';
import {deletionSelection,deletionStreams,planBulkDeletion,bulkDeletionPage,bulkDeletionCSVRows} from './bulk-deletion';
import {csvDigest} from './csv-digest';import {csvRowStream} from './monthly-breakdown';import {validDate} from './finance';
const date=z.string().refine(validDate),scope={selectedIds:deletionSelection,asOf:date.optional()},stamp={expectedRevision:z.number().int().safe().nonnegative(),receipt:z.string().regex(/^[a-f0-9]{64}$/),reviewedOn:date};
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('review'),...scope,expectedRevision:stamp.expectedRevision.optional(),receipt:stamp.receipt.optional(),reviewedOn:date.optional(),stream:z.enum(deletionStreams).default('deleted'),offset:z.number().int().min(0).max(20000).multipleOf(25).default(0)}).strict(),
 z.object({action:z.literal('export'),...scope,...stamp}).strict(),
 z.object({action:z.literal('commit'),...scope,...stamp,confirmation:z.literal('DELETE SELECTED TRANSACTIONS')}).strict()
]).superRefine((c,ctx)=>{if(c.action==='review'){const guarded=c.expectedRevision!==undefined;if(guarded!==(c.receipt!==undefined)||guarded!==(c.reviewedOn!==undefined)||!guarded&&(c.offset||c.stream!=='deleted'))ctx.addIssue({code:'custom',message:'Use the complete current review for navigation.'});}});
export async function executeBulkDeletion(owner:string,input:unknown){
 const c=command.parse(input),state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');const owned=new Set(state.transactions.map(t=>t.id));if(c.selectedIds.some(id=>!owned.has(id)))throw new ApiError(404,'A selected transaction is unavailable. Reload before reviewing deletion.');let plan;try{plan=planBulkDeletion(state,c.selectedIds,c.asOf);}catch(e){throw new ApiError(400,(e as Error).message);}
 const receipt=await csvDigest(JSON.stringify(['bulk-deletion-v1',owner,state.profile.revision,plan.selectedIds,plan.asOf,plan.reviewedOn]));if(c.expectedRevision!==undefined&&(c.expectedRevision!==state.profile.revision||c.receipt!==receipt||c.reviewedOn!==plan.reviewedOn))throw new ApiError(409,'The workspace, selection, valuation date or review date changed. Review deletion again.');
 if(c.action==='review'){try{return {...bulkDeletionPage(plan,c.stream,c.offset),expectedRevision:state.profile.revision,receipt};}catch(e){throw new ApiError(400,(e as Error).message);}}
 if(c.action==='export')return new Response(csvRowStream(bulkDeletionCSVRows(plan,state.profile.revision,receipt)),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="sure-bulk-transaction-deletion.csv"'}});
 const db=database(),statements:D1PreparedStatement[]=[];
 // Bounded parameters also handle restored identities at the existing 160-character limit.
 const chunks=(ids:string[])=>Array.from({length:Math.ceil(ids.length/500)},(_,i)=>JSON.stringify(ids.slice(i*500,i*500+500)));
 for(const ids of chunks(plan.feeLinks.map(f=>f.id)))statements.push(db.prepare('DELETE FROM transfer_fees WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))').bind(owner,ids));
 for(const d of plan.changedDetails)statements.push(db.prepare('UPDATE transfer_details SET source_fee=?,destination_fee=? WHERE owner_id=? AND id=?').bind(d.after.sourceFee,d.after.destinationFee,owner,d.after.id));
 for(const r of plan.released)statements.push(r.resetKind?db.prepare("UPDATE transactions SET transfer_id=NULL,kind='standard',locked_fields=? WHERE owner_id=? AND id=?").bind(JSON.stringify(r.after.lockedFields??[]),owner,r.after.id):db.prepare('UPDATE transactions SET transfer_id=NULL WHERE owner_id=? AND id=?').bind(owner,r.after.id));
 // Ordinary kind edits reset reconciliation. Source release preserves the entry's evidence;
 // restore its unchanged status/statement fields inside the same atomic ledger batch.
 for(const r of plan.released.filter(r=>r.resetKind))statements.push(db.prepare('UPDATE transactions SET reconciled_status=?,reconciled_at=?,reconciled_statement_id=? WHERE owner_id=? AND id=?').bind(r.before.reconciledStatus??'unreconciled',r.before.reconciledAt??null,r.before.reconciledStatementId??null,owner,r.before.id));
 for(const ids of chunks(plan.deletedIds))statements.push(db.prepare('UPDATE recurring_allocations SET transaction_id=NULL,split_line_id=NULL WHERE owner_id=? AND transaction_id IN (SELECT value FROM json_each(?))').bind(owner,ids));
 // Existing FK cascades/retention triggers detach evidence and remove ownership claims atomically.
 for(const ids of chunks(plan.deletedIds))statements.push(db.prepare('DELETE FROM transactions WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))').bind(owner,ids));
 for(const ids of chunks(plan.transferIds))statements.push(db.prepare('DELETE FROM transfer_details WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))').bind(owner,ids));
 await commitMutation(owner,state.profile.revision,statements,28);
 return {message:`Deleted ${plan.counts.deleted} transactions and ${plan.counts.splitLines} split lines. Released ${plan.counts.releasedCounterparts} unselected transfer counterparts; retained recorded payment/goal evidence and receipt files. Reload to inspect the resulting history.`,counts:plan.counts};
}
