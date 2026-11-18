import {z} from 'zod';
import {ApiError,commitMutation,database,readState} from './repository';
import {annotationPatch,annotationSelection,metadataFields,planBulkAnnotations,bulkAnnotationReview,bulkAnnotationCSVRows} from './bulk-annotations';
import {csvDigest} from './csv-digest';
import {csvRowStream} from './monthly-breakdown';
import {today,validDate} from './finance';
const scope={targets:annotationSelection,patch:annotationPatch,reviewedAt:z.string().datetime().optional()},stamp={expectedRevision:z.number().int().safe().nonnegative(),receipt:z.string().regex(/^[a-f0-9]{64}$/),reviewedOn:z.string().refine(validDate)};
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('review'),...scope,expectedRevision:stamp.expectedRevision.optional(),receipt:stamp.receipt.optional(),reviewedOn:stamp.reviewedOn.optional(),effectOffset:z.number().int().min(0).max(20000).multipleOf(25).default(0)}).strict(),
 z.object({action:z.literal('export'),...scope,...stamp}).strict(),
 z.object({action:z.literal('commit'),...scope,...stamp,confirmation:z.literal('APPLY ANNOTATIONS')}).strict()
]).superRefine((c,ctx)=>{if(c.action==='review'){const guarded=c.expectedRevision!==undefined;if(guarded!==(c.receipt!==undefined)||guarded!==(c.reviewedOn!==undefined)||!guarded&&c.effectOffset)ctx.addIssue({code:'custom',message:'Use the current receipt for effects pages.'});}});
export async function executeBulkAnnotations(owner:string,input:unknown){
 const c=command.parse(input),state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');
 for(const t of c.targets)if(!(t.kind==='transaction'?state.transactions:state.splitLines).some(r=>r.id===t.id))throw new ApiError(404,'Selected entry not found. Reload your workspace.');
 const now=new Date().toISOString(),needsTime=c.patch.reconciledStatus==='reconciled';
 if(c.expectedRevision!==undefined&&c.reviewedOn!==today())throw new ApiError(409,'Review these entries again today.');
 if(c.reviewedAt!==undefined&&(!needsTime||c.expectedRevision===undefined||c.reviewedAt.slice(0,10)!==today()||c.reviewedAt>now))throw new ApiError(409,'Refresh the review to obtain its reconciliation time.');
 if(needsTime&&c.expectedRevision!==undefined&&!c.reviewedAt)throw new ApiError(409,'Refresh the review to obtain its reconciliation time.');
 const reviewedAt=needsTime?c.reviewedAt??now:undefined;
 let plan;try{plan=planBulkAnnotations(state,c.targets,c.patch,reviewedAt);}catch(e){throw new ApiError(400,(e as Error).message);}
 const expected=await csvDigest(JSON.stringify(['bulk-annotations-v2',owner,state.profile.revision,plan.targets,plan.patch,plan.reviewedOn,reviewedAt??null]));
 if(c.expectedRevision!==undefined&&(c.expectedRevision!==state.profile.revision||c.receipt!==expected||c.reviewedOn!==plan.reviewedOn))throw new ApiError(409,'The workspace, selection, fields or review date changed. Review the annotations again.');
 if(c.action==='review'){try{return {...bulkAnnotationReview(plan,c.effectOffset),expectedRevision:state.profile.revision,receipt:expected,...(reviewedAt?{reviewedAt}:{})};}catch(e){throw new ApiError(400,(e as Error).message);}}
 if(c.action==='export')return new Response(csvRowStream(bulkAnnotationCSVRows(plan,state.profile.revision,expected)),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="sure-bulk-annotations.csv"'}});
 const db=database(),statements:D1PreparedStatement[]=[],columns={name:'name',notes:'notes',categoryId:'category_id',merchantId:'merchant_id',tagIds:'tag_ids'};
 for(const change of plan.changes){
  const fields=metadataFields.filter(f=>change.fields.includes(f));
  const assignments=fields.map(f=>columns[f]+'=?'),values:(string|null)[]=fields.map(f=>f==='tagIds'?JSON.stringify(change.after.tagIds):change.after[f]??null);
  const root=change.target.kind==='transaction';
  if(change.fields.includes('date')){assignments.push('date=?');values.push(change.posting.date);}
  if(!root&&change.fields.includes('reconciledStatus')&&'reconciliation' in change.after){assignments.push('reconciliation_json=?');values.push(JSON.stringify(change.after.reconciliation));}
  if(assignments.length)statements.push(db.prepare('UPDATE '+(root?'transactions':'split_lines')+' SET '+assignments.join(',')+' WHERE owner_id=? AND id=?').bind(...values,owner,change.target.id));
  // The ordinary date-change trigger clears the old reconciliation before this explicit status is applied.
  if(root&&c.patch.reconciledStatus&&(change.fields.includes('reconciledStatus')||change.fields.includes('date'))&&'accountId' in change.after){
   const row=change.after;
   statements.push(db.prepare('UPDATE transactions SET reconciled_status=?,reconciled_at=?,reconciled_statement_id=? WHERE owner_id=? AND id=?').bind(row.reconciledStatus,row.reconciledAt,row.reconciledStatementId,owner,row.id));
  }
 }
 for(const detail of plan.consequences.transferChanges)statements.push(db.prepare('UPDATE transfer_details SET date=?,destination_date=? WHERE owner_id=? AND id=?').bind(detail.date,detail.destinationDate,owner,detail.id));
 // Even a no-op verifies the revision atomically, without advancing it or changing locks.
 await commitMutation(owner,state.profile.revision,statements,28,{incrementRevision:statements.length>0});
 return {message:`Updated ${plan.counts.modified} entries; ${plan.counts.unchanged} already matched. Reload to inspect the saved annotations.`,counts:plan.counts};
}
