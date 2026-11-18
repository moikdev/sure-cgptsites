import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {ApiError,database,readState,commitMutation} from './repository';
import {csvDigest} from './csv-digest';
import {MERCHANT_CSV_BYTES,merchantDelimiter,planMerchantCSV,merchantsCSV} from './merchant-csv';
import {readStatementBody,contentDisposition} from './file-validation';

export const reserveMerchantCSVSchema=z.object({requestId:z.string().uuid(),filename:z.string().trim().min(1).max(180).refine(v=>!/[\\/\u0000-\u001f]/.test(v)),byteSize:z.number().int().min(1).max(MERCHANT_CSV_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/),delimiter:merchantDelimiter.default(',')}).strict();
export interface MerchantCSVStage {id:string;requestId:string;filename:string;byteSize:number;sha256:string;delimiter:','|';'|'\t'|'|';status:'uploading'|'ready'|'complete'|'deleting';createdAt:string;completedAt:string|null;created:number;reused:number;blank:number;revertedAt:string|null;}
interface Stored extends MerchantCSVStage {storageKey:string;lastRevertReceipt:string|null;}
const select='id,request_id AS requestId,filename,byte_size AS byteSize,sha256,delimiter,status,created_at AS createdAt,completed_at AS completedAt,created,reused,blank,reverted_at AS revertedAt,storage_key AS storageKey,last_revert_receipt AS lastRevertReceipt';
const publicStage=({storageKey,lastRevertReceipt,...stage}:Stored):MerchantCSVStage=>stage;
const bucket=()=>{if(!env.BUCKET)throw new ApiError(503,'Private import storage is unavailable.');return env.BUCKET;};
async function own(owner:string,id:string){const r=await database().prepare(`SELECT ${select} FROM merchant_csv_imports WHERE owner_id=? AND id=?`).bind(owner,id).first<Stored>();if(!r)throw new ApiError(404,'Merchant import not found.');return r;}
export async function listMerchantCSVs(owner:string){const r=await database().prepare(`SELECT ${select} FROM merchant_csv_imports WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 10`).bind(owner).all<Stored>();return {imports:r.results.map(publicStage)};}
const same=(r:Stored,c:z.infer<typeof reserveMerchantCSVSchema>)=>r.filename===c.filename&&r.byteSize===c.byteSize&&r.sha256===c.sha256&&r.delimiter===c.delimiter;
export async function reserveMerchantCSV(owner:string,input:unknown){
  const c=reserveMerchantCSVSchema.parse(input),db=database();
  if(!await db.prepare('SELECT owner_id FROM profiles WHERE owner_id=?').bind(owner).first())throw new ApiError(409,'Create your workspace first.');
  const find=()=>db.prepare(`SELECT ${select} FROM merchant_csv_imports WHERE owner_id=? AND request_id=?`).bind(owner,c.requestId).first<Stored>();
  const old=await find();if(old){if(!same(old,c))throw new ApiError(409,'This request was used for another merchant file or separator.');return {import:publicStage(old)};}
  const id=crypto.randomUUID(),key=`merchant-csv/${id}/${c.sha256}`;
  try{await db.prepare("INSERT INTO merchant_csv_imports(id,owner_id,request_id,filename,byte_size,sha256,delimiter,storage_key,status,created_at) VALUES(?,?,?,?,?,?,?,?,'uploading',?)").bind(id,owner,c.requestId,c.filename,c.byteSize,c.sha256,c.delimiter,key,new Date().toISOString()).run();}
  catch(error){const retry=await find();if(retry&&same(retry,c))return {import:publicStage(retry)};if(String(error).includes('merchant_csv_limit'))throw new ApiError(409,'Keep at most 10 merchant CSV files. Remove an old draft or completed history record first.');throw error;}
  return {import:publicStage(await own(owner,id))};
}
async function bytes(row:Stored){const object=await bucket().get(row.storageKey);if(!object||object.size!==row.byteSize||object.customMetadata?.sha256!==row.sha256)throw new ApiError(409,'The saved merchant source is missing. Upload the original file again.');const result=new Uint8Array(await object.arrayBuffer());if(await csvDigest(result)!==row.sha256)throw new ApiError(409,'The saved merchant source checksum changed. Upload the original file again.');return result;}
export async function uploadMerchantCSV(owner:string,id:string,request:Request){
  const row=await own(owner,id);if(!['uploading','ready'].includes(row.status))throw new ApiError(409,'This merchant import no longer accepts uploads.');
  const input=await readStatementBody(request,MERCHANT_CSV_BYTES);
  if(input.length!==row.byteSize||await csvDigest(input)!==row.sha256)throw new ApiError(400,'File size or checksum differs from the reserved merchant source.');
  try{new TextDecoder('utf-8',{fatal:true}).decode(input);}catch{throw new ApiError(400,'Choose a UTF-8 merchant CSV.');}
  if(input.includes(0))throw new ApiError(400,'Choose a CSV without binary or NUL bytes.');
  await bucket().put(row.storageKey,input,{httpMetadata:{contentType:'text/csv;charset=utf-8'},customMetadata:{sha256:row.sha256}});
  const r=await database().prepare("UPDATE merchant_csv_imports SET status='ready' WHERE owner_id=? AND id=? AND status='uploading'").bind(owner,id).run();
  if(!r.meta.changes){const current=await database().prepare('SELECT status FROM merchant_csv_imports WHERE owner_id=? AND id=?').bind(owner,id).first<{status:string}>();if(!current||!['ready','complete'].includes(current.status)){await bucket().delete(row.storageKey);throw new ApiError(409,'The merchant upload was removed while saving.');}}
  return {import:publicStage(await own(owner,id))};
}
export async function recoverMerchantCSV(owner:string,id:string){const row=await own(owner,id);if(['ready','complete'].includes(row.status))return {import:publicStage(row)};if(row.status!=='uploading')throw new ApiError(409,'This source is being removed.');await bytes(row);await database().prepare("UPDATE merchant_csv_imports SET status='ready' WHERE owner_id=? AND id=? AND status='uploading'").bind(owner,id).run();const current=await own(owner,id);if(!['ready','complete'].includes(current.status))throw new ApiError(409,'The upload changed. Reopen its saved status.');return {import:publicStage(current)};}
export async function merchantSource(owner:string,id:string){const row=await own(owner,id);if(!['ready','complete'].includes(row.status))throw new ApiError(409,'Upload this source before downloading.');return new Response(await bytes(row),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':contentDisposition(row.filename)}});}
export async function exportMerchants(owner:string){const state=await readState(owner);return new Response(merchantsCSV(state.merchants),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':contentDisposition('merchants.csv')}});}
async function prepare(owner:string,row:Stored){
  if(row.status!=='ready')throw new ApiError(409,'Upload this merchant CSV before reviewing it.');
  const state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');
  let plan;try{plan=await planMerchantCSV(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(row)),row.delimiter,state.merchants,owner,JSON.stringify([row.id,row.lastRevertReceipt]));}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,(error as Error).message);}
  const receipt=await csvDigest(JSON.stringify(['merchant-csv-v1',owner,row.id,row.sha256,row.delimiter,row.lastRevertReceipt,state.profile.revision]));
  return {state,plan,receipt};
}
export async function reviewMerchantCSV(owner:string,id:string,offset=0){const row=await own(owner,id);if(row.status==='complete')return {import:publicStage(row),complete:true as const};const p=await prepare(owner,row);return {import:publicStage(row),complete:false as const,expectedRevision:p.state.profile!.revision,receipt:p.receipt,total:p.plan.total,created:p.plan.created.length,reused:p.plan.reused,blank:p.plan.blank,rows:p.plan.rows.slice(offset,offset+25),page:{offset,limit:25,total:p.plan.total}};}
export async function commitMerchantCSV(owner:string,id:string,c:{expectedRevision:number;receipt:string}){
  const row=await own(owner,id);if(row.status==='complete')return {import:publicStage(row),alreadyComplete:true,message:'This merchant CSV is already complete.'};
  const p=await prepare(owner,row);if(c.expectedRevision!==p.state.profile!.revision||c.receipt!==p.receipt)throw new ApiError(409,'Your workspace or merchant import changed. Review it again.');
  const db=database(),statements:D1PreparedStatement[]=[];
  for(let i=0;i<p.plan.created.length;i+=20){const group=p.plan.created.slice(i,i+20);statements.push(db.prepare(`INSERT INTO merchants(id,owner_id,name,color,website_url) VALUES ${group.map(()=>'(?,?,?,?,?)').join(',')}`).bind(...group.flatMap(m=>[m.id,owner,m.name,m.color,m.websiteUrl])));}
  const completedAt=new Date().toISOString();
  statements.push(db.prepare("UPDATE merchant_csv_imports SET status='complete',completed_at=?,created=?,reused=?,blank=? WHERE owner_id=? AND id=?").bind(completedAt,p.plan.created.length,p.plan.reused,p.plan.blank,owner,id));
  try{await commitMutation(owner,p.state.profile!.revision,statements,41,{guardId:'merchant-csv:'+id,incrementRevision:p.plan.created.length>0});}
  catch(error){if(error instanceof ApiError&&error.status===409){const current=await own(owner,id);if(current.status==='complete')return {import:publicStage(current),alreadyComplete:true,message:'This merchant CSV is already complete.'};}throw error;}
  return {import:publicStage(await own(owner,id)),alreadyComplete:false,message:`Created ${p.plan.created.length} merchants, reused ${p.plan.reused} rows and skipped ${p.plan.blank} blank names. Existing merchant details remain unchanged.`};
}
async function reversal(owner:string,row:Stored){if(row.status!=='complete')throw new ApiError(409,'Complete this merchant CSV before resetting it.');const state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');const receipt=await csvDigest(JSON.stringify(['merchant-csv-revert-v1',owner,row.id,row.completedAt,row.lastRevertReceipt,state.profile.revision]));return {import:publicStage(row),expectedRevision:state.profile.revision,receipt,retainedMerchants:true as const,note:'Resetting this import retains every merchant and every financial record. Its original source remains available for a new review.'};}
export async function previewMerchantCSVRevert(owner:string,id:string){return reversal(owner,await own(owner,id));}
export async function revertMerchantCSV(owner:string,id:string,c:{expectedRevision:number;receipt:string}){
  const row=await own(owner,id);if(row.lastRevertReceipt===c.receipt)return {import:publicStage(row),alreadyReverted:true,message:'This merchant import was already reset. All merchants are retained.'};
  const p=await reversal(owner,row);if(c.expectedRevision!==p.expectedRevision||c.receipt!==p.receipt)throw new ApiError(409,'Your workspace or merchant import changed. Review the reset again.');
  try{await commitMutation(owner,p.expectedRevision,[database().prepare("UPDATE merchant_csv_imports SET status='ready',completed_at=NULL,created=0,reused=0,blank=0,reverted_at=?,last_revert_receipt=? WHERE owner_id=? AND id=?").bind(new Date().toISOString(),c.receipt,owner,id)],41,{guardId:'merchant-revert:'+id,incrementRevision:false});}
  catch(error){if(error instanceof ApiError&&error.status===409){const current=await own(owner,id);if(current.lastRevertReceipt===c.receipt)return {import:publicStage(current),alreadyReverted:true,message:'This merchant import was already reset. All merchants are retained.'};}throw error;}
  return {import:publicStage(await own(owner,id)),alreadyReverted:false,message:'Import reset. All merchants and financial records are retained.'};
}
export async function deleteMerchantCSV(owner:string,id:string){const row=await own(owner,id);await database().prepare("UPDATE merchant_csv_imports SET status='deleting' WHERE owner_id=? AND id=?").bind(owner,id).run();await bucket().delete(row.storageKey);await database().prepare("DELETE FROM merchant_csv_imports WHERE owner_id=? AND id=? AND status='deleting'").bind(owner,id).run();return {message:'Merchant source and import history removed. All merchants and financial records are retained.'};}
