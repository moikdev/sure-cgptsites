import {z} from 'zod';
import {today,type FinanceState} from './finance.ts';
import type {RuleLock} from './rule-types.ts';
import {postingChanges,postingConsequences} from './bulk-posting.ts';
import {reconciledStatusSchema} from './reconciliation-schema.ts';
import {ledgerDate,ledgerKey} from './ledger-schema.ts';
import {validateWorkspace} from './workspace.ts';
import {ledgerReportingEffects} from './ledger-report-effects.ts';

export const metadataFields=['name','notes','categoryId','merchantId','tagIds'] as const;
export const annotationFields=[...metadataFields,'date','reconciledStatus'] as const;
export const annotationPatch=z.object({
 date:ledgerDate.optional(),reconciledStatus:reconciledStatusSchema.optional(),
 name:z.string().trim().min(1).max(160).optional(),notes:z.string().max(2000).optional(),
 categoryId:ledgerKey.nullable().optional(),merchantId:ledgerKey.nullable().optional(),
 tagIds:z.array(ledgerKey).max(100).refine(ids=>new Set(ids).size===ids.length,'Tags must be unique.').optional()
}).strict().refine(p=>Object.keys(p).length>0,'Choose at least one field to change.');
export const annotationTarget=z.object({kind:z.enum(['transaction','splitLine']),id:ledgerKey}).strict();
export type AnnotationTarget=z.infer<typeof annotationTarget>;
export type AnnotationPatch=z.infer<typeof annotationPatch>;
export const annotationSelection=z.array(annotationTarget).min(1).max(100).refine(rows=>new Set(rows.map(annotationKey)).size===rows.length,'Select each entry once.');
export function annotationKey(t:AnnotationTarget){return t.kind+':'+t.id;}

/** Source bulk annotations exclude split parents; the port identifies children explicitly. */
export function planBulkAnnotations(state:FinanceState,input:AnnotationTarget[],inputPatch:AnnotationPatch,reviewedAt=today()+'T00:00:00.000Z'){
 if(!state.profile)throw Error('Create your workspace first.');
 const targets=annotationSelection.parse(input).sort((a,b)=>annotationKey(a).localeCompare(annotationKey(b))),patch=annotationPatch.parse(inputPatch),reviewedOn=reviewedAt.slice(0,10),roots=new Map(state.transactions.map(t=>[t.id,t])),lines=new Map(state.splitLines.map(l=>[l.id,l])),parents=new Set(state.splitLines.map(l=>l.transactionId)),accounts=new Map(state.accounts.map(a=>[a.id,a]));
 if(patch.categoryId&&!state.categories.some(c=>c.id===patch.categoryId))throw Error('Category not found in this workspace.');
 if(patch.merchantId&&!state.merchants.some(m=>m.id===patch.merchantId))throw Error('Merchant not found in this workspace.');
 if(patch.tagIds?.some(id=>!state.tags.some(t=>t.id===id)))throw Error('Tag not found in this workspace.');
 const changes=targets.map(target=>{
  const before=target.kind==='transaction'?roots.get(target.id):lines.get(target.id),root=target.kind==='transaction'?roots.get(target.id):before&&'transactionId' in before?roots.get(before.transactionId):undefined;
  if(!before||!root||before.ownerId!==state.profile!.ownerId||root.ownerId!==state.profile!.ownerId)throw Error('Selected entry not found in this workspace.');
  if(target.kind==='transaction'&&parents.has(target.id))throw Error('Choose individual split lines instead of a split parent.');
  const account=accounts.get(root.accountId);if(!account||account.ownerId!==state.profile!.ownerId)throw Error('Selected account not found in this workspace.');
  const metadataChanges=metadataFields.filter(f=>patch[f]!==undefined&&JSON.stringify(before[f]??(f==='tagIds'?[]:f==='merchantId'?null:undefined))!==JSON.stringify(patch[f]));
  const line=target.kind==='splitLine'?lines.get(target.id):undefined;
  const posting=postingChanges(state,root,line,account,patch,reviewedAt);
  const metadata=Object.fromEntries(metadataChanges.map(f=>[f,patch[f]]));
  const fields:(typeof annotationFields[number])[]=[...metadataChanges];
  if(posting.moved)fields.push('date');
  if(posting.statusChanged)fields.push('reconciledStatus');
  const after={...before,...metadata,...(line?posting.lineFields:posting.rootFields),lockedFields:[...new Set([...(before.lockedFields??[]),...metadataChanges.filter(f=>f!=='notes') as RuleLock[]])]};
  return {target,account:{id:account.id,name:account.name,currency:account.currency,archived:!!account.archived},date:root.date,parentId:target.kind==='splitLine'?root.id:null,before,after,fields,posting:{beforeStatus:posting.previous,status:posting.status,date:posting.date,ignoredDate:!!line&&!!patch.date,independent:!!line&&!!patch.reconciledStatus}};
 });
 const byKey=new Map(changes.map(c=>[annotationKey(c.target),c])),next={...state,transactions:state.transactions.map(t=>(byKey.get(annotationKey({kind:'transaction',id:t.id}))?.after??t) as typeof t),splitLines:state.splitLines.map(l=>(byKey.get(annotationKey({kind:'splitLine',id:l.id}))?.after??l) as typeof l)};
 const rootEdits=changes.filter(c=>c.target.kind==='transaction'&&(c.fields.includes('date')||c.fields.includes('reconciledStatus'))).map(c=>next.transactions.find(t=>t.id===c.target.id)!);
 const consequences=postingConsequences(state,next,rootEdits,reviewedOn);
 validateWorkspace({...next,budgets:[]});
 const affected=changes.filter(c=>c.fields.includes('categoryId')||c.fields.includes('date')),effects=ledgerReportingEffects(state,next,affected.flatMap(c=>[{accountId:c.account.id,date:c.date},{accountId:c.account.id,date:c.posting.date}]),reviewedOn);
 return {next,targets,patch,reviewedOn,changes,effects,consequences,counts:{selected:changes.length,modified:changes.filter(c=>c.fields.length).length,unchanged:changes.filter(c=>!c.fields.length).length,splitLines:changes.filter(c=>c.target.kind==='splitLine').length},notes:[
  'Select split lines individually. Each keeps its own amount and parent link.',
  'Tags replace the entire tag list when enabled. An explicit empty list clears tags; disabled fields retain their current values. Empty notes and category/merchant removal are supported.',
  'Changed names, categories, merchants and tag lists receive manual rule locks.',
  'A split line keeps the date of its purchase. Setting its status checks that line independently. Statements check the purchase total separately.',
  'Moving a posting reopens its reconciliation and flags affected completed statements for review. Choose a status in the same edit to apply it on the new date.',
  'Review up to 100 entries at a time. The financial backup includes your original entries.'
 ]};
}
export type BulkAnnotationPlan=ReturnType<typeof planBulkAnnotations>;
export function bulkAnnotationReview(p:BulkAnnotationPlan,effectOffset=0){
 if(!Number.isSafeInteger(effectOffset)||effectOffset<0||effectOffset%25||effectOffset>20000||effectOffset!==0&&effectOffset>=p.effects.length)throw Error('Choose an available effects page.');
 return {targets:p.targets,patch:p.patch,reviewedOn:p.reviewedOn,counts:p.counts,changes:p.changes,postingEffects:{evidence:p.consequences.evidence,balances:p.consequences.balances,transfers:p.consequences.transferChanges.map(d=>({id:d.id,date:d.date,destinationDate:d.destinationDate})),statements:p.consequences.statements.map(s=>({id:s.id,title:s.title,periodEnd:s.periodEnd}))},effects:{rows:p.effects.slice(effectOffset,effectOffset+25),offset:effectOffset,total:p.effects.length},notes:p.notes};
}
export function* bulkAnnotationCSVRows(p:BulkAnnotationPlan,revision:number,receipt:string):Generator<(string|number)[]>{
 yield ['Sure bulk annotation review',revision,receipt,p.reviewedOn];yield ['Counts',JSON.stringify(p.counts)];yield ['Patch',JSON.stringify(p.patch)];
 yield ['entry_type','id','parent_id','account','currency','date','changed_fields','before_json','after_json'];
 for(const c of p.changes)yield [c.target.kind,c.target.id,c.parentId??'',c.account.name,c.account.currency,c.date,c.fields.join(';'),JSON.stringify(c.before),JSON.stringify(c.after)];
 for(const d of p.consequences.transferChanges)yield ['transfer dates',d.id,d.date,d.destinationDate];
 for(const s of p.consequences.statements)yield ['statement review',s.id,s.title,s.periodEnd];
 for(const e of p.consequences.evidence)yield [e.kind,e.id,e.entry,e.date??''];
 for(const a of p.consequences.balances)yield ['account balance',a.id,a.name,a.currency,a.asOf,a.before,a.after];
 yield ['budget_goal_effect_json'];for(const e of p.effects)yield [JSON.stringify(e)];yield ['note'];for(const n of p.notes)yield [n];
}
