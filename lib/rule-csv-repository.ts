import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {ApiError,database,readState,commitMutation} from './repository';
import {csvDigest} from './csv-digest';
import {planRuleCSV,rulesCSV,ruleCSVTemplate} from './rule-csv';
import {RULE_CSV_BYTES,ruleCSVOptionsSchema,type RuleCSVOptions} from './rule-csv-format';
import {ruleColumns,ruleValues} from './rule-persistence';
import {nativeMergeReview} from './native-merge-review';
import type {NativeMergeChange} from './native-merge';
import {readStatementBody,contentDisposition} from './file-validation';

export const reserveRuleCSVSchema=z.object({requestId:z.string().uuid(),filename:z.string().trim().min(1).max(180).refine(v=>!/[\\/\u0000-\u001f]/.test(v)),byteSize:z.number().int().min(1).max(RULE_CSV_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/),options:ruleCSVOptionsSchema}).strict();
export interface RuleCSVStage {id:string;requestId:string;filename:string;byteSize:number;sha256:string;options:RuleCSVOptions;status:'uploading'|'ready'|'complete'|'deleting';createdAt:string;completedAt:string|null;created:number;updated:number;total:number;disabled:number;revertedAt:string|null;}
interface Stored extends Omit<RuleCSVStage,'options'> {optionsJSON:string;storageKey:string;lastRevertReceipt:string|null;}
const select='id,request_id AS requestId,filename,byte_size AS byteSize,sha256,options_json AS optionsJSON,status,created_at AS createdAt,completed_at AS completedAt,created,updated,total,disabled,reverted_at AS revertedAt,storage_key AS storageKey,last_revert_receipt AS lastRevertReceipt';
const publicStage=({storageKey,lastRevertReceipt,optionsJSON,...stage}:Stored):RuleCSVStage=>({...stage,options:ruleCSVOptionsSchema.parse(JSON.parse(optionsJSON))});
const bucket=()=>{if(!env.BUCKET)throw new ApiError(503,'Private import storage is unavailable.');return env.BUCKET;};
async function own(owner:string,id:string){const r=await database().prepare(`SELECT ${select} FROM rule_csv_imports WHERE owner_id=? AND id=?`).bind(owner,id).first<Stored>();if(!r)throw new ApiError(404,'Rule import not found.');return r;}
export async function listRuleCSVs(owner:string){const r=await database().prepare(`SELECT ${select} FROM rule_csv_imports WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 10`).bind(owner).all<Stored>();return {imports:r.results.map(publicStage)};}
const same=(r:Stored,c:z.infer<typeof reserveRuleCSVSchema>)=>r.filename===c.filename&&r.byteSize===c.byteSize&&r.sha256===c.sha256&&r.optionsJSON===JSON.stringify(c.options);
export async function reserveRuleCSV(owner:string,input:unknown){
  const c=reserveRuleCSVSchema.parse(input),db=database();
  if(!await db.prepare('SELECT owner_id FROM profiles WHERE owner_id=?').bind(owner).first())throw new ApiError(409,'Create your workspace first.');
  const find=()=>db.prepare(`SELECT ${select} FROM rule_csv_imports WHERE owner_id=? AND request_id=?`).bind(owner,c.requestId).first<Stored>();
  const old=await find();if(old){if(!same(old,c))throw new ApiError(409,'This request was used for another rule file or options.');return {import:publicStage(old)};}
  const id=crypto.randomUUID(),key=`rule-csv/${id}/${c.sha256}`;
  try{await db.prepare("INSERT INTO rule_csv_imports(id,owner_id,request_id,filename,byte_size,sha256,options_json,storage_key,status,created_at) VALUES(?,?,?,?,?,?,?,?,'uploading',?)").bind(id,owner,c.requestId,c.filename,c.byteSize,c.sha256,JSON.stringify(c.options),key,new Date().toISOString()).run();}
  catch(error){const retry=await find();if(retry&&same(retry,c))return {import:publicStage(retry)};if(String(error).includes('rule_csv_limit'))throw new ApiError(409,'Keep at most 10 rule CSV files. Remove an old draft or completed history record first.');throw error;}
  return {import:publicStage(await own(owner,id))};
}
async function bytes(row:Stored){const object=await bucket().get(row.storageKey);if(!object||object.size!==row.byteSize||object.customMetadata?.sha256!==row.sha256)throw new ApiError(409,'The saved rule source is missing. Upload the original file again.');const result=new Uint8Array(await object.arrayBuffer());if(await csvDigest(result)!==row.sha256)throw new ApiError(409,'The saved rule source checksum changed. Upload the original file again.');return result;}
export async function uploadRuleCSV(owner:string,id:string,request:Request){
  const row=await own(owner,id);if(!['uploading','ready'].includes(row.status))throw new ApiError(409,'This rule import no longer accepts uploads.');
  const input=await readStatementBody(request,RULE_CSV_BYTES);
  if(input.length!==row.byteSize||await csvDigest(input)!==row.sha256)throw new ApiError(400,'File size or checksum differs from the reserved rule source.');
  try{new TextDecoder('utf-8',{fatal:true}).decode(input);}catch{throw new ApiError(400,'Choose a UTF-8 rule CSV.');}
  if(input.includes(0))throw new ApiError(400,'Choose a CSV without binary or NUL bytes.');
  await bucket().put(row.storageKey,input,{httpMetadata:{contentType:'text/csv;charset=utf-8'},customMetadata:{sha256:row.sha256}});
  const r=await database().prepare("UPDATE rule_csv_imports SET status='ready' WHERE owner_id=? AND id=? AND status='uploading'").bind(owner,id).run();
  if(!r.meta.changes){const current=await database().prepare('SELECT status FROM rule_csv_imports WHERE owner_id=? AND id=?').bind(owner,id).first<{status:string}>();if(!current||!['ready','complete'].includes(current.status)){await bucket().delete(row.storageKey);throw new ApiError(409,'The rule upload was removed while saving.');}}
  return {import:publicStage(await own(owner,id))};
}
export async function recoverRuleCSV(owner:string,id:string){const row=await own(owner,id);if(['ready','complete'].includes(row.status))return {import:publicStage(row)};if(row.status!=='uploading')throw new ApiError(409,'This source is being removed.');await bytes(row);await database().prepare("UPDATE rule_csv_imports SET status='ready' WHERE owner_id=? AND id=? AND status='uploading'").bind(owner,id).run();const current=await own(owner,id);if(!['ready','complete'].includes(current.status))throw new ApiError(409,'The upload changed. Reopen its saved status.');return {import:publicStage(current)};}
export async function ruleSource(owner:string,id:string){const row=await own(owner,id);if(!['ready','complete'].includes(row.status))throw new ApiError(409,'Upload this source before downloading.');return new Response(await bytes(row),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':contentDisposition(row.filename)}});}
function csvResponse(csv:string,filename:string){return new Response(csv,{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':contentDisposition(filename)}});}
export async function exportRules(owner:string){const state=await readState(owner);try{return csvResponse(rulesCSV(state),'rules.csv');}catch(error){throw new ApiError(400,(error as Error).message);}}
export function exportRuleCSVTemplate(){return csvResponse(ruleCSVTemplate(),'sure-rule-template.csv');}
async function prepare(owner:string,row:Stored){
 if(row.status!=='ready')throw new ApiError(409,'Upload this rule CSV before reviewing it.');
 const state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');
 const options=ruleCSVOptionsSchema.parse(JSON.parse(row.optionsJSON));let plan;
 try{plan=await planRuleCSV(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(row)),options,state,JSON.stringify([row.id,row.lastRevertReceipt]));}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,(error as Error).message);}
 const receipt=await csvDigest(JSON.stringify(['rule-csv-v1',owner,row.id,row.sha256,row.optionsJSON,row.lastRevertReceipt,state.profile.revision]));
 return {state,plan,receipt};
}
export async function reviewRuleCSV(owner:string,id:string,offset=0,changeOffset=0){
 const row=await own(owner,id);if(row.status==='complete')return {import:publicStage(row),complete:true as const};const p=await prepare(owner,row);
 const changes:NativeMergeChange[]=[];
 for(const key of ['categories','tags','merchants'] as const)for(const r of p.plan.created[key])changes.push({collection:key,id:r.id,name:r.name,before:null,after:r as unknown as NativeMergeChange['after']});
 for(const r of p.plan.changedRules)changes.push({collection:'rules',id:r.id,name:r.name,before:p.state.rules.find(old=>old.id===r.id) as unknown as NativeMergeChange['after']??null,after:r as unknown as NativeMergeChange['after']});
 return {import:publicStage(row),complete:false as const,expectedRevision:p.state.profile!.revision,receipt:p.receipt,total:p.plan.total,created:p.plan.createdRules.length,updated:p.plan.updatedRules.length,disabled:p.plan.disabled,metadata:Object.fromEntries(Object.entries(p.plan.created).map(([k,v])=>[k,v.length])),rows:p.plan.rows.slice(offset,offset+25).map(r=>({row:r.row,sourceName:r.sourceName,name:r.after.name,action:r.action,active:r.after.active,blockedReason:r.after.blockedReason,notes:r.notes,originalConfiguration:r.after.blockedReason&&r.after.sourceJson?JSON.parse(r.after.sourceJson).source:null})),page:{offset,limit:25,total:p.plan.total},changes:nativeMergeReview(changes.slice(changeOffset,changeOffset+25),p.state,p.plan.data),changePage:{offset:changeOffset,limit:25,total:changes.length}};
}
// A history-only reset need not increment the finance revision. Assert the
// exact lifecycle snapshot inside the same batch as the financial writes.
function cycleGuard(owner:string,row:Stored){return database().prepare("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT ?,?,-1,42 WHERE NOT EXISTS(SELECT 1 FROM rule_csv_imports WHERE owner_id=? AND id=? AND status=? AND completed_at IS ? AND last_revert_receipt IS ?)").bind('rule-cycle:'+row.id,owner,owner,row.id,row.status,row.completedAt,row.lastRevertReceipt);}
export async function commitRuleCSV(owner:string,id:string,c:{expectedRevision:number;receipt:string}){
 const row=await own(owner,id);if(row.status==='complete')return {import:publicStage(row),alreadyComplete:true,message:'This rule CSV is already complete.'};
 const p=await prepare(owner,row);if(c.expectedRevision!==p.state.profile!.revision||c.receipt!==p.receipt)throw new ApiError(409,'Your workspace or rule import changed. Review it again.');
 const db=database(),statements:D1PreparedStatement[]=[cycleGuard(owner,row)];
 for(const [key,columns] of [['categories',['id','owner_id','name','color','parent_id','lucide_icon']],['tags',['id','owner_id','name','color']],['merchants',['id','owner_id','name','color','website_url']]] as const){
  const list=p.plan.created[key];for(let i=0;i<list.length;i+=Math.floor(96/columns.length)){const group=list.slice(i,i+Math.floor(96/columns.length));statements.push(db.prepare(`INSERT INTO ${key}(${columns.join(',')}) VALUES ${group.map(()=>'('+columns.map(()=>'?').join(',')+')').join(',')}`).bind(...group.flatMap(r=>[r.id,owner,r.name,r.color,...(key==='categories'?[null,'shapes']:key==='merchants'?[null]:[])])));}
 }
 const columns=ruleColumns('rules');for(const r of p.plan.changedRules){const vals=ruleValues('rules',r);if(p.plan.createdRules.some(v=>v.id===r.id))statements.push(db.prepare(`INSERT INTO transaction_rules(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).bind(...vals));else statements.push(db.prepare(`UPDATE transaction_rules SET ${columns.slice(2).map(k=>k+'=?').join(',')} WHERE owner_id=? AND id=?`).bind(...vals.slice(2),owner,r.id));}
 statements.push(db.prepare("UPDATE rule_csv_imports SET status='complete',completed_at=?,created=?,updated=?,total=?,disabled=? WHERE owner_id=? AND id=?").bind(new Date().toISOString(),p.plan.createdRules.length,p.plan.updatedRules.length,p.plan.total,p.plan.disabled,owner,id));
 try{await commitMutation(owner,p.state.profile!.revision,statements,42,{guardId:'rule-csv:'+id,incrementRevision:!!(p.plan.changedRules.length+Object.values(p.plan.created).reduce((n,v)=>n+v.length,0))});}
 catch(error){if(error instanceof ApiError&&error.status===409){const current=await own(owner,id);if(current.status==='complete')return {import:publicStage(current),alreadyComplete:true,message:'This rule CSV is already complete.'};}throw error;}
 return {import:publicStage(await own(owner,id)),alreadyComplete:false,message:`Created ${p.plan.createdRules.length} rules and updated ${p.plan.updatedRules.length}; ${p.plan.disabled} stored disabled for review. Rules were saved without running against existing transactions.`};
}
async function reversal(owner:string,row:Stored){if(row.status!=='complete')throw new ApiError(409,'Complete this rule CSV before resetting it.');const state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');const receipt=await csvDigest(JSON.stringify(['rule-csv-revert-v1',owner,row.id,row.completedAt,row.lastRevertReceipt,state.profile.revision]));return {import:publicStage(row),expectedRevision:state.profile.revision,receipt,retainedRules:true as const,note:'Resetting this import retains every rule, category, merchant, tag and financial record. Its original source remains available for a new review.'};}
export async function previewRuleCSVRevert(owner:string,id:string){return reversal(owner,await own(owner,id));}
export async function revertRuleCSV(owner:string,id:string,c:{expectedRevision:number;receipt:string}){
  const row=await own(owner,id);if(row.lastRevertReceipt===c.receipt)return {import:publicStage(row),alreadyReverted:true,message:'This rule import was already reset. All rules are retained.'};
  const p=await reversal(owner,row);if(c.expectedRevision!==p.expectedRevision||c.receipt!==p.receipt)throw new ApiError(409,'Your workspace or rule import changed. Review the reset again.');
  try{await commitMutation(owner,p.expectedRevision,[cycleGuard(owner,row),database().prepare("UPDATE rule_csv_imports SET status='ready',completed_at=NULL,created=0,updated=0,total=0,disabled=0,reverted_at=?,last_revert_receipt=? WHERE owner_id=? AND id=?").bind(new Date().toISOString(),c.receipt,owner,id)],42,{guardId:'rule-revert:'+id,incrementRevision:false});}
  catch(error){if(error instanceof ApiError&&error.status===409){const current=await own(owner,id);if(current.lastRevertReceipt===c.receipt)return {import:publicStage(current),alreadyReverted:true,message:'This rule import was already reset. All rules are retained.'};}throw error;}
  return {import:publicStage(await own(owner,id)),alreadyReverted:false,message:'Import reset. All rules, labels and financial records are retained.'};
}
export async function deleteRuleCSV(owner:string,id:string){const row=await own(owner,id);await database().prepare("UPDATE rule_csv_imports SET status='deleting' WHERE owner_id=? AND id=?").bind(owner,id).run();await bucket().delete(row.storageKey);await database().prepare("DELETE FROM rule_csv_imports WHERE owner_id=? AND id=? AND status='deleting'").bind(owner,id).run();return {message:'Rule source and import history removed. All rules, labels and financial records are retained.'};}
