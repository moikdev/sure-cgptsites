import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {ApiError,database,readState,commitMutation} from './repository';
import {csvDigest} from './csv-digest';
import {CATEGORY_CSV_BYTES,categoryDelimiter,planCategoryCSV,categoriesCSV} from './category-csv';
import {readStatementBody,contentDisposition} from './file-validation';
import {today} from './finance';
import {budgetChangeStatements} from './budget-repository';

export const reserveCategoryCSVSchema=z.object({requestId:z.string().uuid(),filename:z.string().trim().min(1).max(180).refine(v=>!/[\\/\u0000-\u001f]/.test(v)),byteSize:z.number().int().min(1).max(CATEGORY_CSV_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/),delimiter:categoryDelimiter.default(',')}).strict();
export interface CategoryCSVStage {id:string;requestId:string;filename:string;byteSize:number;sha256:string;delimiter:','|';'|'\t'|'|';status:'uploading'|'ready'|'complete'|'deleting';createdAt:string;completedAt:string|null;created:number;updated:number;total:number;revertedAt:string|null;}
interface Stored extends CategoryCSVStage {storageKey:string;lastRevertReceipt:string|null;}
const select='id,request_id AS requestId,filename,byte_size AS byteSize,sha256,delimiter,status,created_at AS createdAt,completed_at AS completedAt,created,updated,total,reverted_at AS revertedAt,storage_key AS storageKey,last_revert_receipt AS lastRevertReceipt';
const publicStage=({storageKey,lastRevertReceipt,...stage}:Stored):CategoryCSVStage=>stage;
const bucket=()=>{if(!env.BUCKET)throw new ApiError(503,'Private import storage is unavailable.');return env.BUCKET;};
async function own(owner:string,id:string){const r=await database().prepare(`SELECT ${select} FROM category_csv_imports WHERE owner_id=? AND id=?`).bind(owner,id).first<Stored>();if(!r)throw new ApiError(404,'Category import not found.');return r;}
export async function listCategoryCSVs(owner:string){const r=await database().prepare(`SELECT ${select} FROM category_csv_imports WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 10`).bind(owner).all<Stored>();return {imports:r.results.map(publicStage)};}
const same=(r:Stored,c:z.infer<typeof reserveCategoryCSVSchema>)=>r.filename===c.filename&&r.byteSize===c.byteSize&&r.sha256===c.sha256&&r.delimiter===c.delimiter;
export async function reserveCategoryCSV(owner:string,input:unknown){
  const c=reserveCategoryCSVSchema.parse(input),db=database();
  if(!await db.prepare('SELECT owner_id FROM profiles WHERE owner_id=?').bind(owner).first())throw new ApiError(409,'Create your workspace first.');
  const find=()=>db.prepare(`SELECT ${select} FROM category_csv_imports WHERE owner_id=? AND request_id=?`).bind(owner,c.requestId).first<Stored>();
  const old=await find();if(old){if(!same(old,c))throw new ApiError(409,'This request was used for another category file or separator.');return {import:publicStage(old)};}
  const id=crypto.randomUUID(),key=`category-csv/${id}/${c.sha256}`;
  try{await db.prepare("INSERT INTO category_csv_imports(id,owner_id,request_id,filename,byte_size,sha256,delimiter,storage_key,status,created_at) VALUES(?,?,?,?,?,?,?,?,'uploading',?)").bind(id,owner,c.requestId,c.filename,c.byteSize,c.sha256,c.delimiter,key,new Date().toISOString()).run();}
  catch(error){const retry=await find();if(retry&&same(retry,c))return {import:publicStage(retry)};if(String(error).includes('category_csv_limit'))throw new ApiError(409,'Keep at most 10 category CSV files. Remove an old draft or completed history record first.');throw error;}
  return {import:publicStage(await own(owner,id))};
}
async function bytes(row:Stored){const object=await bucket().get(row.storageKey);if(!object||object.size!==row.byteSize||object.customMetadata?.sha256!==row.sha256)throw new ApiError(409,'The saved category source is missing. Upload the original file again.');const result=new Uint8Array(await object.arrayBuffer());if(await csvDigest(result)!==row.sha256)throw new ApiError(409,'The saved category source checksum changed. Upload the original file again.');return result;}
export async function uploadCategoryCSV(owner:string,id:string,request:Request){
  const row=await own(owner,id);if(!['uploading','ready'].includes(row.status))throw new ApiError(409,'This category import no longer accepts uploads.');
  const input=await readStatementBody(request,CATEGORY_CSV_BYTES);
  if(input.length!==row.byteSize||await csvDigest(input)!==row.sha256)throw new ApiError(400,'File size or checksum differs from the reserved category source.');
  try{new TextDecoder('utf-8',{fatal:true}).decode(input);}catch{throw new ApiError(400,'Choose a UTF-8 category CSV.');}
  if(input.includes(0))throw new ApiError(400,'Choose a CSV without binary or NUL bytes.');
  await bucket().put(row.storageKey,input,{httpMetadata:{contentType:'text/csv;charset=utf-8'},customMetadata:{sha256:row.sha256}});
  const r=await database().prepare("UPDATE category_csv_imports SET status='ready' WHERE owner_id=? AND id=? AND status='uploading'").bind(owner,id).run();
  if(!r.meta.changes){const current=await database().prepare('SELECT status FROM category_csv_imports WHERE owner_id=? AND id=?').bind(owner,id).first<{status:string}>();if(!current||!['ready','complete'].includes(current.status)){await bucket().delete(row.storageKey);throw new ApiError(409,'The category upload was removed while saving.');}}
  return {import:publicStage(await own(owner,id))};
}
export async function recoverCategoryCSV(owner:string,id:string){const row=await own(owner,id);if(['ready','complete'].includes(row.status))return {import:publicStage(row)};if(row.status!=='uploading')throw new ApiError(409,'This source is being removed.');await bytes(row);await database().prepare("UPDATE category_csv_imports SET status='ready' WHERE owner_id=? AND id=? AND status='uploading'").bind(owner,id).run();const current=await own(owner,id);if(!['ready','complete'].includes(current.status))throw new ApiError(409,'The upload changed. Reopen its saved status.');return {import:publicStage(current)};}
export async function categorySource(owner:string,id:string){const row=await own(owner,id);if(!['ready','complete'].includes(row.status))throw new ApiError(409,'Upload this source before downloading.');return new Response(await bytes(row),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':contentDisposition(row.filename)}});}
export async function exportCategories(owner:string){const state=await readState(owner);return new Response(categoriesCSV(state.categories),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':contentDisposition('categories.csv')}});}
async function prepare(owner:string,row:Stored){
  if(row.status!=='ready')throw new ApiError(409,'Upload this category CSV before reviewing it.');
  const state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');
  const reviewedOn=today();let plan;try{plan=await planCategoryCSV(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(row)),row.delimiter,state,JSON.stringify([owner,row.id,row.lastRevertReceipt]),reviewedOn);}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,(error as Error).message);}
  const receipt=await csvDigest(JSON.stringify(['category-csv-v1',owner,row.id,row.sha256,row.delimiter,row.lastRevertReceipt,state.profile.revision,reviewedOn]));
  return {state,plan,receipt,reviewedOn};
}
export async function reviewCategoryCSV(owner:string,id:string,offset=0,changeOffset=0,budgetOffset=0){const row=await own(owner,id);if(row.status==='complete')return {import:publicStage(row),complete:true as const};const p=await prepare(owner,row);return {import:publicStage(row),complete:false as const,expectedRevision:p.state.profile!.revision,receipt:p.receipt,reviewedOn:p.reviewedOn,total:p.plan.total,created:p.plan.created,updated:p.plan.updated,rows:p.plan.rows.slice(offset,offset+25),page:{offset,limit:25,total:p.plan.total},changes:p.plan.changes.slice(changeOffset,changeOffset+25),changePage:{offset:changeOffset,limit:25,total:p.plan.changes.length},budgetChanges:p.plan.budgetChanges.slice(budgetOffset,budgetOffset+25),budgetPage:{offset:budgetOffset,limit:25,total:p.plan.budgetChanges.length},reportEffects:p.plan.reportEffects};}
export async function commitCategoryCSV(owner:string,id:string,c:{expectedRevision:number;receipt:string;reviewedOn:string}){
  const row=await own(owner,id);if(row.status==='complete')return {import:publicStage(row),alreadyComplete:true,message:'This category CSV is already complete.'};
  const p=await prepare(owner,row);if(c.expectedRevision!==p.state.profile!.revision||c.receipt!==p.receipt||c.reviewedOn!==p.reviewedOn)throw new ApiError(409,'Your workspace or category import changed. Review it again.');
  const db=database(),statements:D1PreparedStatement[]=[];
  const created=p.plan.changes.filter(change=>!change.before).map(change=>change.after).sort((a,b)=>Number(!!a.parentId)-Number(!!b.parentId));
  for(let i=0;i<created.length;i+=16){const group=created.slice(i,i+16);statements.push(db.prepare(`INSERT INTO categories(id,owner_id,name,color,parent_id,lucide_icon) VALUES ${group.map(()=>'(?,?,?,?,?,?)').join(',')}`).bind(...group.flatMap(c=>[c.id,owner,c.name,c.color,c.parentId??null,c.lucideIcon??null])));}
  for(const {after} of p.plan.changes.filter(change=>change.before))statements.push(db.prepare('UPDATE categories SET color=?,parent_id=?,lucide_icon=? WHERE owner_id=? AND id=?').bind(after.color,after.parentId??null,after.lucideIcon??null,owner,after.id));
  statements.push(...budgetChangeStatements(owner,p.state,p.plan.state));
  const completedAt=new Date().toISOString();
  statements.push(db.prepare("UPDATE category_csv_imports SET status='complete',completed_at=?,created=?,updated=?,total=? WHERE owner_id=? AND id=?").bind(completedAt,p.plan.created,p.plan.updated,p.plan.total,owner,id));
  try{await commitMutation(owner,p.state.profile!.revision,statements,42,{guardId:'category-csv:'+id,incrementRevision:p.plan.changes.length>0||p.plan.budgetChanges.length>0});}
  catch(error){if(error instanceof ApiError&&error.status===409){const current=await own(owner,id);if(current.status==='complete')return {import:publicStage(current),alreadyComplete:true,message:'This category CSV is already complete.'};}throw error;}
  return {import:publicStage(await own(owner,id)),alreadyComplete:false,message:`Created ${p.plan.created} categories and updated ${p.plan.updated} existing categories from ${p.plan.total} source rows. Shared categories and their metadata remain after import reset.`};
}
async function reversal(owner:string,row:Stored){if(row.status!=='complete')throw new ApiError(409,'Complete this category CSV before resetting it.');const state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');const receipt=await csvDigest(JSON.stringify(['category-csv-revert-v1',owner,row.id,row.completedAt,row.lastRevertReceipt,state.profile.revision]));return {import:publicStage(row),expectedRevision:state.profile.revision,receipt,retainedCategories:true as const,note:'Resetting this import retains every category and every financial record. Its original source remains available for a new review.'};}
export async function previewCategoryCSVRevert(owner:string,id:string){return reversal(owner,await own(owner,id));}
export async function revertCategoryCSV(owner:string,id:string,c:{expectedRevision:number;receipt:string}){
  const row=await own(owner,id);if(row.lastRevertReceipt===c.receipt)return {import:publicStage(row),alreadyReverted:true,message:'This category import was already reset. All categories are retained.'};
  const p=await reversal(owner,row);if(c.expectedRevision!==p.expectedRevision||c.receipt!==p.receipt)throw new ApiError(409,'Your workspace or category import changed. Review the reset again.');
  try{await commitMutation(owner,p.expectedRevision,[database().prepare("UPDATE category_csv_imports SET status='ready',completed_at=NULL,created=0,updated=0,total=0,reverted_at=?,last_revert_receipt=? WHERE owner_id=? AND id=?").bind(new Date().toISOString(),c.receipt,owner,id)],42,{guardId:'category-revert:'+id,incrementRevision:false});}
  catch(error){if(error instanceof ApiError&&error.status===409){const current=await own(owner,id);if(current.lastRevertReceipt===c.receipt)return {import:publicStage(current),alreadyReverted:true,message:'This category import was already reset. All categories are retained.'};}throw error;}
  return {import:publicStage(await own(owner,id)),alreadyReverted:false,message:'Import reset. All categories and financial records are retained.'};
}
export async function deleteCategoryCSV(owner:string,id:string){const row=await own(owner,id);await database().prepare("UPDATE category_csv_imports SET status='deleting' WHERE owner_id=? AND id=?").bind(owner,id).run();await bucket().delete(row.storageKey);await database().prepare("DELETE FROM category_csv_imports WHERE owner_id=? AND id=? AND status='deleting'").bind(owner,id).run();return {message:'Category source and import history removed. All categories and financial records are retained.'};}
