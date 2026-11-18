import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {ApiError,database,readState,commitMutation} from './repository';
import {csvDigest} from './csv-digest';
import {canonicalTradeCSVOptions,tradeCSVOptionsSchema,planTradeCSV,type TradeCSVOptions} from './trade-csv-plan';
import {STAGED_TRADE_LIMITS} from './investment-csv-mapping';
import {investmentColumns,investmentValues} from './investment-persistence';
import {investmentCSVTemplateStatements} from './investment-csv-template-repository';
import {planTradeCSVRevert,tradeCSVRevertPage} from './trade-csv-revert';
import {csvRevertFinancialStatements} from './csv-import-revert-repository';
import {today} from './finance';
const TRADE_CSV_BYTES=STAGED_TRADE_LIMITS.maxBytes;
import {readStatementBody,contentDisposition} from './file-validation';

export const reserveTradeCSVSchema=z.object({requestId:z.string().uuid(),filename:z.string().trim().min(1).max(180).refine(v=>!/[\\/\u0000-\u001f]/.test(v)),byteSize:z.number().int().min(1).max(TRADE_CSV_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/),options:tradeCSVOptionsSchema}).strict();
export interface TradeCSVStage {id:string;requestId:string;filename:string;byteSize:number;sha256:string;options:TradeCSVOptions;status:'uploading'|'ready'|'complete'|'deleting';createdAt:string;completedAt:string|null;imported:number;skipped:number;createdAccounts:number;revertedAt:string|null;}
interface Stored extends Omit<TradeCSVStage,'options'> {optionsJSON:string;storageKey:string;lastRevertReceipt:string|null;}
const select='id,request_id AS requestId,filename,byte_size AS byteSize,sha256,options_json AS optionsJSON,status,created_at AS createdAt,completed_at AS completedAt,imported,skipped,created_accounts AS createdAccounts,reverted_at AS revertedAt,storage_key AS storageKey,last_revert_receipt AS lastRevertReceipt';
const publicStage=({storageKey,lastRevertReceipt,optionsJSON,...stage}:Stored):TradeCSVStage=>({...stage,options:JSON.parse(optionsJSON)});
const bucket=()=>{if(!env.BUCKET)throw new ApiError(503,'Private import storage is unavailable.');return env.BUCKET;};
async function own(owner:string,id:string){const r=await database().prepare(`SELECT ${select} FROM trade_csv_imports WHERE owner_id=? AND id=?`).bind(owner,id).first<Stored>();if(!r)throw new ApiError(404,'Trade import not found.');return r;}
export async function listTradeCSVs(owner:string){const r=await database().prepare(`SELECT ${select} FROM trade_csv_imports WHERE owner_id=? ORDER BY created_at DESC,id DESC LIMIT 10`).bind(owner).all<Stored>();return {imports:r.results.map(publicStage)};}
const same=(r:Stored,c:z.infer<typeof reserveTradeCSVSchema>)=>r.filename===c.filename&&r.byteSize===c.byteSize&&r.sha256===c.sha256&&r.optionsJSON===JSON.stringify(c.options);
export async function reserveTradeCSV(owner:string,input:unknown){
  const c=reserveTradeCSVSchema.parse(input),db=database();c.options=canonicalTradeCSVOptions(c.options);
  if(!await db.prepare('SELECT owner_id FROM profiles WHERE owner_id=?').bind(owner).first())throw new ApiError(409,'Create your workspace first.');
  const find=()=>db.prepare(`SELECT ${select} FROM trade_csv_imports WHERE owner_id=? AND request_id=?`).bind(owner,c.requestId).first<Stored>();
  const old=await find();if(old){if(!same(old,c))throw new ApiError(409,'This request was used for another trade file or saved settings.');return {import:publicStage(old)};}
  const id=crypto.randomUUID(),key=`trade-csv/${id}/${c.sha256}`;
  try{await db.prepare("INSERT INTO trade_csv_imports(id,owner_id,request_id,filename,byte_size,sha256,options_json,storage_key,status,created_at) VALUES(?,?,?,?,?,?,?,?,'uploading',?)").bind(id,owner,c.requestId,c.filename,c.byteSize,c.sha256,JSON.stringify(c.options),key,new Date().toISOString()).run();}
  catch(error){const retry=await find();if(retry&&same(retry,c))return {import:publicStage(retry)};if(String(error).includes('trade_csv_limit'))throw new ApiError(409,'Keep at most 10 trade CSV files. Remove an old draft or completed history record first.');throw error;}
  return {import:publicStage(await own(owner,id))};
}
async function bytes(row:Stored){const object=await bucket().get(row.storageKey);if(!object||object.size!==row.byteSize||object.customMetadata?.sha256!==row.sha256)throw new ApiError(409,'The saved trade source is missing. Upload the original file again.');const result=new Uint8Array(await object.arrayBuffer());if(await csvDigest(result)!==row.sha256)throw new ApiError(409,'The saved trade source checksum changed. Upload the original file again.');return result;}
export async function uploadTradeCSV(owner:string,id:string,request:Request){
  const row=await own(owner,id);if(!['uploading','ready','complete'].includes(row.status))throw new ApiError(409,'This trade import no longer accepts uploads.');
  const input=await readStatementBody(request,TRADE_CSV_BYTES);
  if(input.length!==row.byteSize||await csvDigest(input)!==row.sha256)throw new ApiError(400,'File size or checksum differs from the reserved trade source.');
  try{new TextDecoder('utf-8',{fatal:true}).decode(input);}catch{throw new ApiError(400,'Choose a UTF-8 trade CSV.');}
  if(input.includes(0))throw new ApiError(400,'Choose a CSV without binary or NUL bytes.');
  await bucket().put(row.storageKey,input,{httpMetadata:{contentType:'text/csv;charset=utf-8'},customMetadata:{sha256:row.sha256}});
  const r=await database().prepare("UPDATE trade_csv_imports SET status='ready' WHERE owner_id=? AND id=? AND status='uploading'").bind(owner,id).run();
  if(!r.meta.changes){const current=await database().prepare('SELECT status FROM trade_csv_imports WHERE owner_id=? AND id=?').bind(owner,id).first<{status:string}>();if(!current||!['ready','complete'].includes(current.status)){await bucket().delete(row.storageKey);throw new ApiError(409,'The trade upload was removed while saving.');}}
  return {import:publicStage(await own(owner,id))};
}
export async function recoverTradeCSV(owner:string,id:string){const row=await own(owner,id);if(['ready','complete'].includes(row.status))return {import:publicStage(row)};if(row.status!=='uploading')throw new ApiError(409,'This source is being removed.');await bytes(row);await database().prepare("UPDATE trade_csv_imports SET status='ready' WHERE owner_id=? AND id=? AND status='uploading'").bind(owner,id).run();const current=await own(owner,id);if(!['ready','complete'].includes(current.status))throw new ApiError(409,'The upload changed. Reopen its saved status.');return {import:publicStage(current)};}
export async function tradeSource(owner:string,id:string){const row=await own(owner,id);if(!['ready','complete'].includes(row.status))throw new ApiError(409,'Upload this source before downloading.');return new Response(await bytes(row),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':contentDisposition(row.filename)}});}
function cycleGuard(owner:string,row:Stored){return database().prepare("INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT ?,?,-1,38 WHERE NOT EXISTS(SELECT 1 FROM trade_csv_imports WHERE owner_id=? AND id=? AND status=? AND completed_at IS ? AND last_revert_receipt IS ?)").bind('trade-cycle:'+row.id,owner,owner,row.id,row.status,row.completedAt,row.lastRevertReceipt);}
async function prepare(owner:string,row:Stored){
 if(row.status!=='ready')throw new ApiError(409,'Upload this trade CSV before reviewing it.');const state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');let plan;
 try{plan=await planTradeCSV(state,new TextDecoder('utf-8',{fatal:true}).decode(await bytes(row)),JSON.parse(row.optionsJSON),JSON.stringify([row.id,row.lastRevertReceipt]),today());}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,(error as Error).message);}
 const receipt=await csvDigest(JSON.stringify(['staged-trade-v1',owner,row.id,row.sha256,row.optionsJSON,row.lastRevertReceipt,state.profile.revision,plan.reviewedOn]));return {state,plan,receipt};
}
export async function reviewTradeCSV(owner:string,id:string,offset=0,positionOffset=0,effectOffset=0){
 const row=await own(owner,id);if(row.status==='complete')return {import:publicStage(row),complete:true as const};const p=await prepare(owner,row),names=new Map(p.plan.next.securities.map(s=>[s.id,{ticker:s.ticker,exchange:s.exchange}]));
 return {import:publicStage(row),complete:false as const,expectedRevision:p.state.profile!.revision,receipt:p.receipt,reviewedOn:p.plan.reviewedOn,total:p.plan.total,imported:p.plan.result.trades.length,skipped:p.plan.result.skipped,newAccounts:p.plan.result.newAccounts,accounts:p.plan.accounts,rows:p.plan.result.reviewRows.slice(offset,offset+25).map(r=>({...r,...names.get(r.trade.securityId),accountName:p.plan.next.accounts.find(a=>a.id===r.trade.accountId)!.name})),page:{offset,limit:25,total:p.plan.total},positions:p.plan.positions.slice(positionOffset,positionOffset+25),positionPage:{offset:positionOffset,limit:25,total:p.plan.positions.length},effects:p.plan.effects.slice(effectOffset,effectOffset+25),effectPage:{offset:effectOffset,limit:25,total:p.plan.effects.length}};
}
export async function commitTradeCSV(owner:string,id:string,c:{expectedRevision:number;receipt:string;reviewedOn:string}){
 const row=await own(owner,id);if(row.status==='complete')return {import:publicStage(row),alreadyComplete:true,message:'This trade CSV is already complete. Later records were retained.'};const p=await prepare(owner,row);if(c.expectedRevision!==p.state.profile!.revision||c.receipt!==p.receipt||c.reviewedOn!==p.plan.reviewedOn)throw new ApiError(409,'The workspace, trade import or reviewed day changed. Review it again.');
 const db=database(),statements:D1PreparedStatement[]=[cycleGuard(owner,row)],result=p.plan.result;
 for(let i=0;i<result.newAccounts.length;i+=16){const group=result.newAccounts.slice(i,i+16);statements.push(db.prepare(`INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date,archived,excluded_from_reports,cash_planning_excluded) VALUES ${group.map(()=>'(?,?,?,?,?,0,?,0,0,NULL)').join(',')}`).bind(...group.flatMap(a=>[a.id,owner,a.name,a.type,a.currency,a.openingDate])));}
 const columns=investmentColumns('trades');for(let i=0;i<result.trades.length;i+=5){const group=result.trades.slice(i,i+5);statements.push(db.prepare(`INSERT INTO trades(${columns.join(',')}) VALUES ${group.map(()=>'('+columns.map(()=>'?').join(',')+')').join(',')}`).bind(...group.flatMap(t=>investmentValues('trades',t))));}
 const targets=[...new Set(result.reviewRows.map(r=>r.trade.accountId))];statements.push(...investmentCSVTemplateStatements(owner,'trades',targets,p.plan.template));
 const claimed=result.reviewRows.filter(r=>!r.duplicate);for(let i=0;i<claimed.length;i+=25){const group=claimed.slice(i,i+25);statements.push(db.prepare(`INSERT INTO trade_csv_entries(owner_id,import_id,trade_id,row_number) VALUES ${group.map(()=>'(?,?,?,?)').join(',')}`).bind(...group.flatMap(r=>[owner,id,r.trade.id,r.row])));}
 for(let i=0;i<result.newAccounts.length;i+=33){const group=result.newAccounts.slice(i,i+33);statements.push(db.prepare(`INSERT INTO trade_csv_accounts(owner_id,import_id,account_id) VALUES ${group.map(()=>'(?,?,?)').join(',')}`).bind(...group.flatMap(a=>[owner,id,a.id])));}
 statements.push(db.prepare("UPDATE trade_csv_imports SET status='complete',completed_at=?,imported=?,skipped=?,created_accounts=? WHERE owner_id=? AND id=?").bind(new Date().toISOString(),result.trades.length,result.skipped,result.newAccounts.length,owner,id));
 try{await commitMutation(owner,p.state.profile!.revision,statements,8,{guardId:'trade-csv:'+id,incrementRevision:!!(result.trades.length+result.newAccounts.length)});}catch(error){if(error instanceof ApiError&&error.status===409){const saved=await own(owner,id);if(saved.status==='complete')return {import:publicStage(saved),alreadyComplete:true,message:'This trade CSV is already complete. Its writes were not repeated.'};}throw error;}
 return {import:publicStage(await own(owner,id)),alreadyComplete:false,message:`Imported ${result.trades.length} investment activities, skipped ${result.skipped} existing rows and created ${result.newAccounts.length} manual accounts. Original bytes and import ownership are saved.`};
}
async function reversal(owner:string,row:Stored){
 if(row.status!=='complete')throw new ApiError(409,'Complete this trade CSV before reversing it.');const state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');const claims=await database().batch([database().prepare('SELECT trade_id AS id FROM trade_csv_entries WHERE owner_id=? AND import_id=? ORDER BY row_number').bind(owner,row.id),database().prepare('SELECT account_id AS id FROM trade_csv_accounts WHERE owner_id=? AND import_id=? ORDER BY account_id').bind(owner,row.id)]);let plan;
 try{plan=planTradeCSVRevert(state,(claims[0].results as {id:string}[]).map(r=>r.id),(claims[1].results as {id:string}[]).map(r=>r.id),today());}catch(error){throw new ApiError(400,(error as Error).message);}
 const receipt=await csvDigest(JSON.stringify(['staged-trade-revert-v1',owner,row.id,row.completedAt,row.lastRevertReceipt,state.profile.revision,plan.review,plan.tradeDeletions,plan.positions]));return {state,plan,receipt};
}
export async function previewTradeCSVRevert(owner:string,id:string,offset=0,effectOffset=0,releaseOffset=0,tradeOffset=0,positionOffset=0){const row=await own(owner,id),p=await reversal(owner,row);return {...tradeCSVRevertPage(p.plan,offset,effectOffset,releaseOffset,tradeOffset,positionOffset),import:publicStage(row),expectedRevision:p.state.profile!.revision,receipt:p.receipt};}
export async function revertTradeCSV(owner:string,id:string,c:{expectedRevision:number;receipt:string;reviewedOn:string}){
 const row=await own(owner,id);if(row.lastRevertReceipt===c.receipt)return {import:publicStage(row),alreadyReverted:true,message:'This trade reversal already completed. Later financial records were retained.'};const p=await reversal(owner,row);if(c.expectedRevision!==p.state.profile!.revision||c.receipt!==p.receipt||c.reviewedOn!==p.plan.review.reviewedOn)throw new ApiError(409,'The workspace, trade import or reviewed day changed. Review the entire reversal again.');
 const statements=[cycleGuard(owner,row),...csvRevertFinancialStatements(owner,p.plan)];if(p.plan.removedTradeIds.length)statements.push(database().prepare('DELETE FROM trades WHERE owner_id=? AND id IN (SELECT value FROM json_each(?))').bind(owner,JSON.stringify(p.plan.removedTradeIds)));
 statements.push(database().prepare('DELETE FROM trade_csv_entries WHERE owner_id=? AND import_id=?').bind(owner,id),database().prepare('DELETE FROM trade_csv_accounts WHERE owner_id=? AND import_id=?').bind(owner,id),database().prepare("UPDATE trade_csv_imports SET status='ready',completed_at=NULL,imported=0,skipped=0,created_accounts=0,reverted_at=?,last_revert_receipt=? WHERE owner_id=? AND id=?").bind(new Date().toISOString(),c.receipt,owner,id));
 try{await commitMutation(owner,p.state.profile!.revision,statements,38,{guardId:'trade-revert:'+id,incrementRevision:!!(p.plan.removedTradeIds.length+p.plan.removedAccountIds.length+p.plan.removedIds.length+p.plan.review.released.length)});}catch(error){if(error instanceof ApiError&&error.status===409){const saved=await own(owner,id);if(saved.lastRevertReceipt===c.receipt)return {import:publicStage(saved),alreadyReverted:true,message:'This trade reversal already completed. Records were not removed twice.'};}throw error;}
 return {import:publicStage(await own(owner,id)),alreadyReverted:false,message:`Reversed ${p.plan.tradeDeletions.length} current trades and ${p.plan.removedAccountIds.length} import-created accounts with all their contents. Original source is ready for another review.`};
}
export async function deleteTradeCSV(owner:string,id:string){const row=await own(owner,id);await database().prepare("UPDATE trade_csv_imports SET status='deleting' WHERE owner_id=? AND id=?").bind(owner,id).run();await bucket().delete(row.storageKey);await database().prepare("DELETE FROM trade_csv_imports WHERE owner_id=? AND id=? AND status='deleting'").bind(owner,id).run();return {message:'Trade source and import history removed. All accounts, trades and financial records are retained.'};}
