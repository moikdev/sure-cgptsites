import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import {localFetch as fetch} from './local-http.mjs';
const origin='http://127.0.0.1:8799',owner=`migration-${crypto.randomUUID()}`,other=`migration-${crypto.randomUUID()}`;
let requests=0;
async function request(path,body,status=200,user=owner,headers={}) {
  requests++;const payload=body===undefined?undefined:Buffer.from(typeof body==='string'?body:JSON.stringify(body));
  const result=await fetch(origin+path,{method:payload===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':`${user}@example.test`}:{}),...headers},...(payload===undefined?{}:{body:payload})});
  const response={status:result.status,headers:Object.fromEntries(result.headers),raw:await result.text()};
  const raw=response.raw;let data;try{data=JSON.parse(raw);}catch{throw new Error(`Request ${requests} ${path}: HTTP ${response.status}: ${raw.slice(0,180)}`);}assert.equal(response.status,status,JSON.stringify(data));assert.match(response.headers['cache-control'],/no-store/);return data;
}
const post=(body,status=200,user=owner)=>request('/api/finance',body,status,user),get=(user=owner)=>request('/api/finance',undefined,200,user);
const migration=(body,status=200,user=owner)=>request('/api/migration',body,status,user);
await migration({},401,null);await request('/api/migration',{},403,owner,{Origin:'https://other.invalid'});await request('/api/migration',{},415,owner,{'Content-Type':'text/plain'});
await post({action:'initialize',name:'Restore test',currency:'USD'});await post({action:'initialize',name:'Other user',currency:'EUR'},200,other);
const untouched=await get(other),fixture=readFileSync(new URL('./fixtures/sure-v2.ndjson',import.meta.url),'utf8');
const command={sourceFormat:'sure',content:fixture,exportDate:'2026-02-28',mode:'empty'};
const initial=await get();const preview=await migration({...command,action:'preview'});
assert.equal(preview.counts.accounts,3);assert.equal(preview.counts.transactions,6);assert.equal(preview.counts.transferPairs,1);assert.ok(preview.warnings.length>0);assert.deepEqual(await get(),initial);
const commit=(p=preview,overrides={})=>({...command,action:'commit',receipt:p.receipt,expectedRevision:p.expectedRevision,confirmation:'RESTORE',acknowledgeWarnings:true,...overrides});
await migration(commit(preview,{confirmation:'NO'}),400);await migration(commit(preview,{acknowledgeWarnings:false}),400);assert.deepEqual(await get(),initial);
await post({action:'profile',name:'Concurrent change',currency:'USD'});await migration(commit(),409);
let p=await migration({...command,action:'preview'});
const racing=await Promise.all([fetch(origin+'/api/migration',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'local@example.test'},body:JSON.stringify(commit(p))}),fetch(origin+'/api/migration',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'oai-authenticated-user-id':owner,'oai-authenticated-user-email':'local@example.test'},body:JSON.stringify(commit(p))})]);
requests+=2;
const statuses=racing.map(r=>r.status).sort();const bodies=await Promise.all(racing.map(r=>r.json()));assert.deepEqual(statuses,[200,409],JSON.stringify(bodies));
let restored=await get();assert.equal(restored.accounts.length,3);assert.equal(restored.transactions.length,6);assert.equal(restored.profile.revision,p.expectedRevision+1);
assert.ok(restored.accounts.every(a=>a.ownerId===owner));assert.ok(restored.accounts.every(a=>!['bank','card','yen'].includes(a.id)));
assert.ok(restored.transactions.every(t=>restored.accounts.some(a=>a.id===t.accountId)));assert.equal(new Set(restored.transactions.filter(t=>t.transferId).map(t=>t.transferId)).size,1);assert.equal(restored.valuations.find(v=>v.name==='Sure export balance'&&restored.accounts.find(a=>a.id===v.accountId).name==='Main bank').amount,90075);
assert.equal(restored.accounts.find(a=>a.name==='Yen savings').excludedFromReports,1);assert.deepEqual(await get(other),untouched);
await migration({...command,action:'preview'},409);
const backup={format:'sure-sites',version:2,...restored};
// Source owner IDs, globally colliding IDs, and even a victim's copied backup never grant access to their records.
const restoreCommand={sourceFormat:'sites',content:JSON.stringify(backup),mode:'empty'};
const foreignPreview=await migration({...restoreCommand,action:'preview'},200,other);
await migration({...restoreCommand,action:'commit',receipt:foreignPreview.receipt,expectedRevision:foreignPreview.expectedRevision,confirmation:'RESTORE'},200,other);
const remapped=await get(other);assert.ok(remapped.accounts.every(a=>a.ownerId===other));assert.ok(remapped.accounts.every(a=>!restored.accounts.some(old=>old.id===a.id)));assert.deepEqual(await get(),restored);
const corrupted=structuredClone(backup);corrupted.transactions[0].accountId='missing-account';
await migration({action:'preview',sourceFormat:'sites',content:JSON.stringify(corrupted),mode:'replace'},400);assert.deepEqual(await get(),restored);
// Valuations are authorized, editable, retained in state, and prevent deleting non-empty accounts.
const bank=restored.accounts.find(a=>a.name==='Main bank');
await post({action:'valuation',accountId:bank.id,date:'2026-03-01',amount:123456,name:'March reconciliation'});
let current=await get();const value=current.valuations.find(v=>v.name==='March reconciliation');assert.ok(value);
await post({action:'valuation',id:value.id,accountId:bank.id,date:'2026-03-01',amount:124000,name:'Updated reconciliation'});
await post({action:'deleteValuation',id:value.id},404,other);await post({action:'valuation',accountId:bank.id,date:'2026-03-01',amount:1,name:'Foreign'},404,other);
await post({action:'deleteAccount',id:bank.id},409);await post({action:'deleteValuation',id:value.id});
// Category DAG writes reject self-links, cycles and foreign parents.
current=await get();const food=current.categories.find(c=>c.name==='Food'),groceries=current.categories.find(c=>c.name==='Groceries');
await post({action:'category',id:food.id,name:food.name,color:food.color,parentId:food.id},400);
await post({action:'category',id:food.id,name:food.name,color:food.color,parentId:groceries.id},400);
await post({action:'category',id:food.id,name:food.name,color:food.color,parentId:remapped.categories[0].id},404);
const replace={...restoreCommand,mode:'replace'};
p=await migration({...replace,action:'preview'});
// An older application version or an external database edit must invalidate a preview too.
assert.match(owner,/^migration-[a-f0-9-]+$/);assert.match(bank.id,/^[a-f0-9-]+$/);
execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',`UPDATE accounts SET name = 'External edit' WHERE owner_id = '${owner}' AND id = '${bank.id}'`],{stdio:'pipe'});
await migration({...replace,action:'commit',receipt:p.receipt,expectedRevision:p.expectedRevision,confirmation:'REPLACE'},409);
p=await migration({...replace,action:'preview'});assert.equal(p.replaced.accounts,3);
await migration({...replace,action:'commit',receipt:p.receipt,expectedRevision:p.expectedRevision,confirmation:'RESTORE'},400);
await migration({...replace,action:'commit',receipt:p.receipt,expectedRevision:p.expectedRevision,confirmation:'REPLACE'});
restored=await get();assert.equal(restored.transactions.length,6);assert.equal(restored.profile.revision,p.expectedRevision+1);
await migration({...replace,action:'commit',receipt:p.receipt,expectedRevision:p.expectedRevision,confirmation:'REPLACE'},409);
// Bulk insertion crosses the 100-parameter boundary without dropping or duplicating rows.
const big=structuredClone(backup);big.splitLines=[];big.transactions=Array.from({length:1100},(_,i)=>({...backup.transactions.find(t=>!t.transferId),id:`bulk-${i}`,importKey:null,transferId:null,name:`Bulk ${i}`,kind:'standard'}));
const large={sourceFormat:'sites',content:JSON.stringify(big),mode:'replace'};p=await migration({...large,action:'preview'});assert.equal(p.counts.transactions,1100);
await migration({...large,action:'commit',receipt:p.receipt,expectedRevision:p.expectedRevision,confirmation:'REPLACE'});assert.equal((await get()).transactions.length,1100);
console.log(`Passed ${requests} migration API checks, including preview-only reads, concurrent commits, stale receipts, isolation, valuations, category cycles, round-trip restore, and 1,100-row atomic bulk import.`);
