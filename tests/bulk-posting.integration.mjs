import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {localFetch} from './local-http.mjs';
import {readBackupArchive} from '../lib/backup-archive.ts';

const origin='http://127.0.0.1:8799',owner='posting-edit-'+randomUUID(),copy=owner+'-copy';
let checks=0;
async function call(path,body,user=owner,status=200){
 const res=await localFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'},...(body?{body:JSON.stringify(body)}:{})});
 checks++;assert.equal(res.status,status,await res.clone().text().then(t=>t.slice(0,500)));return path.endsWith('/archive')?res.blob():res.json();
}
const finance=(body,user)=>call('/api/finance',body,user),edit=(body,status)=>call('/api/bulk-annotations',body,owner,status);
async function restore(content,user){
 const options={sourceFormat:'sites',mode:'replace',content};
 const p=await call('/api/migration',{...options,action:'preview'},user);
 await call('/api/migration',{...options,action:'commit',expectedRevision:p.expectedRevision,receipt:p.receipt,confirmation:'REPLACE',acknowledgeWarnings:true},user);
 return finance(undefined,user);
}
function stamp(r){return {receipt:r.receipt,expectedRevision:r.expectedRevision,reviewedOn:r.reviewedOn,reviewedAt:r.reviewedAt};}
for(const u of [owner,copy])await finance({action:'initialize',currency:'USD',name:'Synthetic posting test'},u);
for(const name of ['Source','Destination'])await finance({action:'account',type:'checking',name,currency:'USD',openingDate:'2020-01-01',openingBalance:100000});
let state=await finance(),source=state.accounts.find(a=>a.name==='Source'),dest=state.accounts.find(a=>a.name==='Destination');
await finance({action:'transfer',fromId:source.id,toId:dest.id,amount:1000,date:'2026-01-01',name:'Paired transfer',notes:'',sourceFee:25,destinationFee:0,requestId:randomUUID(),tagIds:[]});
await finance({action:'transaction',accountId:source.id,date:'2026-01-02',name:'Purchase',amount:-100,categoryId:null,kind:'standard',notes:'',tagIds:[]});
state=await finance();let parent=state.transactions.find(t=>t.name==='Purchase'),out=state.transactions.find(t=>t.transferId&&t.amount<0),fee=state.transferFees[0];
await finance({action:'reconcileTransactions',ids:[parent.id],status:'reconciled'});
await finance({action:'setSplit',id:parent.id,amount:-100,lines:[-70,-30].map((amount,i)=>({amount,name:'Item '+i,categoryId:null,merchantId:null,tagIds:[],notes:'',kind:'standard',excluded:0}))});
state=await finance();
const statement={id:randomUUID(),accountId:source.id,title:'January statement',currency:'USD',periodStart:'2026-01-01',periodEnd:'2026-01-31',openingBalance:100000,closingBalance:98875,notes:'',createdAt:'2026-02-01T12:00:00.000Z',completedAt:'2026-02-01T12:00:00.000Z',snapshotOpening:100000,snapshotClosing:98875,reviewRequired:0,adjustmentType:null,adjustmentId:null,adjustmentBefore:null,adjustmentAfter:null};
state.transactions.find(t=>t.id===out.id).reconciledStatus='reconciled';
Object.assign(state.transactions.find(t=>t.id===out.id),{reconciledAt:statement.completedAt,reconciledStatementId:statement.id});
state.accountStatements.push(statement);
state=await restore(JSON.stringify({format:'sure-sites',version:36,...state,budgets:[]}),owner);
parent=state.transactions.find(t=>t.name==='Purchase');out=state.transactions.find(t=>t.transferId&&t.amount<0);fee=state.transferFees[0];
const [line,sibling]=state.splitLines,original=structuredClone(state);
assert.equal(line.reconciliation.status,'unreconciled');
const target=(id,kind='transaction')=>({kind,id}),single={targets:[target(out.id)],patch:{date:'2026-01-05'}};
await edit({action:'review',...single},400);
const args={targets:[target(out.id),target(fee.transactionId),target(line.id,'splitLine')],patch:{date:'2026-01-05',reconciledStatus:'reconciled',notes:'Reviewed'}};
const p=await edit({action:'review',...args});
assert.equal(p.postingEffects.statements[0].title,statement.title);assert.equal(p.postingEffects.transfers.length,1);assert.equal(p.changes.find(c=>c.target.id===line.id).posting.ignoredDate,true);
const command={action:'commit',...args,...stamp(p),confirmation:'APPLY ANNOTATIONS'};
await edit({...command,reviewedAt:'2020-01-01T00:00:00.000Z'},409);
await edit({...command,reviewedAt:undefined},409);
assert.deepEqual(await finance(),original);
await edit(command);await edit(command,409);state=await finance();
for(const c of p.changes)assert.deepEqual((c.target.kind==='transaction'?state.transactions:state.splitLines).find(t=>t.id===c.target.id),c.after);
assert.equal(state.transactions.find(t=>t.id===parent.id).date,parent.date);
assert.deepEqual(state.splitLines.find(l=>l.id===sibling.id),sibling);
assert.equal(state.transactions.find(t=>t.id===out.id).reconciledStatementId,null);assert.equal(state.accountStatements[0].reviewRequired,1);assert.equal(state.accountStatements[0].snapshotClosing,statement.snapshotClosing);
assert.deepEqual(state.transferDetails[0],{...original.transferDetails[0],date:'2026-01-05'});
const unchanged=await edit({action:'review',...args});assert.equal(unchanged.counts.modified,0);
await edit({...command,...stamp(unchanged)});assert.deepEqual(await finance(),state);
const backup=await readBackupArchive(await call('/api/statement-files/archive'),'sites'),payload=JSON.parse(backup.content);
assert.equal(payload.version,36);assert.deepEqual(payload.splitLines.find(l=>l.id===line.id).reconciliation,{status:'reconciled',at:p.reviewedAt});
const recovered=await restore(backup.content,copy);
assert.deepEqual(recovered.splitLines.map(l=>[l.position,l.reconciliation]),state.splitLines.map(l=>[l.position,l.reconciliation]));
await restore(backup.content,copy); // An aware restore may replace explicit child flags twice.
writeFileSync('outputs/bulk-posting-proof.json',JSON.stringify({owner,state,copy,copyState:await finance(undefined,copy)}));
console.log('PASS '+checks+' Worker requests for posting edits, transfer fees, split isolation, timestamp receipts, replay, no-op and version 36 ZIP recovery.');
