import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const origin='http://127.0.0.1:8799',owner=`ledger-${crypto.randomUUID()}`,other=`ledger-${crypto.randomUUID()}`;
const today=new Date().toISOString().slice(0,10),month=today.slice(0,7),due=`${month}-01`;
let requests=0;
async function request(path,body,status=200,user=owner){requests++;const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,'oai-authenticated-user-id':user,'oai-authenticated-user-email':`${user}@example.test`},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;}
const post=(body,status=200,user=owner)=>request('/api/finance',body,status,user),get=(user=owner)=>request('/api/finance',undefined,200,user),migrate=(body,status=200,user=owner)=>request('/api/migration',body,status,user);
await post({action:'initialize',name:'Ledger test',currency:'USD'});await post({action:'initialize',name:'Other',currency:'USD'},200,other);
const account=(name,currency='USD')=>({action:'account',name,currency,type:'checking',openingBalance:100000,openingDate:'2026-01-01'});
await post(account('Cash'));await post(account('Savings'));await post(account('Euro','EUR'));
await post({action:'tag',name:'Travel, Europe',color:'#6699aa'});await post({action:'tag',name:'Work',color:'#6699aa'});
await post({action:'merchant',name:'Market',color:'#6699aa',websiteUrl:'https://example.com'});
await post({action:'merchant',name:'Unsafe',color:'#6699aa',websiteUrl:'javascript:alert(1)'},400);
let s=await get();const cash=s.accounts.find(a=>a.name==='Cash'),savings=s.accounts.find(a=>a.name==='Savings'),eur=s.accounts.find(a=>a.name==='Euro'),tag=s.tags.find(t=>t.name==='Travel, Europe'),work=s.tags.find(t=>t.name==='Work'),merchant=s.merchants[0],category=s.categories.find(c=>c.name==='Groceries');
await post({action:'tag',name:'TRAVEL, EUROPE',color:'#6699aa'},409);
const tx={action:'transaction',name:'Purchase',date:due,accountId:cash.id,categoryId:category.id,amount:-1000,kind:'standard',notes:'',merchantId:merchant.id,tagIds:[tag.id]};
await post(tx);s=await get();const purchase=s.transactions[0];assert.deepEqual(purchase.tagIds,[tag.id]);assert.equal(purchase.merchantId,merchant.id);
const split={action:'setSplit',id:purchase.id,amount:-1000,lines:[{name:'Food',amount:-600,categoryId:category.id,merchantId:merchant.id,tagIds:[tag.id]},{name:'Office',amount:-400,tagIds:[work.id]}]};
await post({...split,lines:[{name:'Bad',amount:-599},{name:'Other',amount:-400}]},400);assert.equal((await get()).splitLines.length,0);
await post(split);s=await get();assert.equal(s.splitLines.length,2);assert.equal(s.transactions.length,1);assert.equal(s.transactions[0].amount,-1000);assert.equal(s.splitLines.reduce((n,l)=>n+l.amount,0),-1000);
await post({...tx,id:purchase.id,amount:-999},400);await post({...tx,id:purchase.id,name:'Edited purchase'});
await post({action:'setSplit',...split,id:purchase.id},404,other);await post({action:'transactionMetadata',id:purchase.id,merchantId:merchant.id,tagIds:[tag.id]},404,other);
await post({action:'tag',id:tag.id,name:'Foreign',color:'#6699aa'},404,other);await post({action:'deleteMerchant',id:merchant.id},404,other);
await post(account('Foreign'),200,other);const foreign=(await get(other)).accounts[0];await post({...tx,accountId:foreign.id},404);
await post({action:'tag',name:'Foreign tag',color:'#6699aa'},200,other);const foreignTag=(await get(other)).tags[0];await post({...tx,tagIds:[foreignTag.id]},404);await post({...split,lines:[{name:'Bad',amount:-600,tagIds:[foreignTag.id]},{name:'Other',amount:-400}]},404);
const csv='date,name,amount,merchant,tags,excluded\n'+due+',CSV,-3.25,Market,"[""Travel, Europe""]",true';await post({action:'import',accountId:cash.id,csv});s=await get();assert.equal(s.transactions.find(t=>t.name==='CSV').excluded,1);assert.deepEqual(s.transactions.find(t=>t.name==='CSV').tagIds,[tag.id]);
assert.match((await post({action:'import',accountId:cash.id,csv})).message,/Imported 0/);
const series={action:'recurring',name:'Rent',accountId:cash.id,destinationAccountId:null,categoryId:category.id,merchantId:merchant.id,tagIds:[tag.id],amount:-1000,currency:'USD',billType:'bill',status:'active',anchorDate:due,startsOn:due,expectedDayOfMonth:1,rules:[{frequency:'monthly',interval:1,dayOfMonth:1,weekday:null,weekdayOrdinal:null,monthOfYear:null}],endMode:'never',endOn:null,endAfterCount:null,weekendAdjust:'none',amountStrategy:'fixed',expectedAmountMin:null,expectedAmountMax:null,expectedAmountAvg:null,notifyDaysBefore:3,overdueGraceDays:3,notes:'Manual recurring',paymentUrl:null,autopay:0};
await post({...series,accountId:foreign.id},404);await post(series);
s=await get();let rent=s.recurringEntries[0];const bootstrap=[],horizon=new Date(Date.parse(today)+90*86400000).toISOString().slice(0,10);for(let cursor=due;cursor<=horizon;){bootstrap.push(cursor);const d=new Date(cursor+'T00:00:00Z');cursor=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1)).toISOString().slice(0,10);}assert.deepEqual(s.recurringOccurrences.map(o=>o.dueOn).sort(),bootstrap);assert.equal(s.transactions.length,2);const rentOccurrence=state=>state.recurringOccurrences.find(o=>o.recurringEntryId===rent.id&&o.originalDueOn===due);
const payment={action:'payOccurrence',recurringEntryId:rent.id,originalDueOn:due,requestId:crypto.randomUUID(),mode:'new',amount:400,paidOn:today};
await post(payment);s=await get();const partial=rentOccurrence(s),created=s.recurringAllocations[0];assert.equal(partial.status,'scheduled');assert.equal(partial.expectedAmount,1000);assert.equal(s.transactions.find(t=>t.id===created.transactionId).amount,-400);
const count=s.transactions.length;await post(payment);assert.equal((await get()).transactions.length,count);await post({...payment,amount:401},409);await post(payment,404,other);
await post({...tx,id:created.transactionId,amount:-500},400);
const second={...payment,requestId:crypto.randomUUID(),mode:'record',amount:600};await post(second);s=await get();assert.equal(rentOccurrence(s).status,'paid');assert.equal(s.transactions.length,count);
await post({...second,requestId:crypto.randomUUID()},409);
await post({action:'deleteTransaction',id:created.transactionId});s=await get();assert.equal(s.recurringAllocations.find(a=>a.id===created.id).transactionId,null);assert.equal(rentOccurrence(s).status,'paid');
await post({action:'deleteAllocation',id:second.requestId});s=await get();assert.equal(rentOccurrence(s).status,'scheduled');
await post({action:'occurrence',recurringEntryId:rent.id,originalDueOn:due,operation:'snooze',snoozedUntil:`${month}-28`});
s=await get();assert.equal(rentOccurrence(s).snoozedUntil,`${month}-28`);
await post({action:'occurrence',recurringEntryId:rent.id,originalDueOn:due,operation:'skip'});await post({...payment,requestId:crypto.randomUUID()},409);
await post({action:'occurrence',recurringEntryId:rent.id,originalDueOn:due,operation:'reopen'});
await post({...payment,requestId:crypto.randomUUID(),mode:'link',transactionId:purchase.id,amount:600});
s=await get();assert.equal(rentOccurrence(s).status,'paid');assert.equal(s.transactions.length,count-1);
// One purchase cannot fund more than its total across different bills.
await post({...series,name:'Another bill'});s=await get();const another=s.recurringEntries.find(r=>r.name==='Another bill');await post({...payment,requestId:crypto.randomUUID(),recurringEntryId:another.id,mode:'link',transactionId:purchase.id,amount:401},400);
await post({...payment,requestId:crypto.randomUUID(),recurringEntryId:another.id,mode:'link',transactionId:purchase.id,amount:400});
// Concurrent retries share one request identity and one account entry.
const racePayment={...payment,recurringEntryId:another.id,requestId:crypto.randomUUID(),amount:100};const beforeRace=(await get()).transactions.length;
const races=await Promise.all([0,1].map(()=>fetch(origin+'/api/finance',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'oai-authenticated-user-id':owner,'oai-authenticated-user-email':`${owner}@example.test`},body:JSON.stringify(racePayment)})));requests+=2;
const raceBodies=await Promise.all(races.map(r=>r.json()));assert.ok(races.every(r=>[200,409].includes(r.status)),JSON.stringify(raceBodies));assert.ok(races.some(r=>r.status===200));await post(racePayment);s=await get();assert.equal(s.transactions.length,beforeRace+1);assert.equal(s.recurringAllocations.filter(a=>a.id===racePayment.requestId).length,1);
// Future prices change without rewriting already-due unpaid history.
await post({...series,name:'Historical',anchorDate:'2026-01-01',startsOn:'2026-01-01',amount:-2500});s=await get();const historical=s.recurringEntries.find(r=>r.name==='Historical');
await post({...series,...historical,action:'recurring',amount:-3000});s=await get();const old=s.recurringOccurrences.filter(o=>o.recurringEntryId===historical.id);assert.ok(old.length>=1);assert.ok(old.filter(o=>o.dueOn<=today).every(o=>o.expectedAmount===2500));assert.ok(old.filter(o=>o.dueOn>today).every(o=>o.expectedAmount===null));assert.equal(s.recurringEntries.find(r=>r.id===historical.id).amount,-3000);
await post({...series,...s.recurringEntries.find(r=>r.id===historical.id),action:'recurring',accountId:eur.id,currency:'EUR'},400);
await post({...series,...s.recurringEntries.find(r=>r.id===historical.id),action:'recurring',status:'paused'});s=await get();const beforeResume=structuredClone(s.recurringOccurrences);
await post({...series,...s.recurringEntries.find(r=>r.id===historical.id),action:'recurring',status:'active'});s=await get();assert.equal(s.recurringEntries.find(r=>r.id===historical.id).startsOn,today);assert.ok(beforeResume.every(o=>s.recurringOccurrences.some(after=>after.id===o.id&&JSON.stringify(after)===JSON.stringify(o))));assert.ok(s.recurringOccurrences.some(o=>o.recurringEntryId===historical.id&&o.dueOn>=today&&!beforeResume.some(before=>before.id===o.id)));
// Manual recurring transfers create exactly two balanced legs, once.
await post({...series,name:'Monthly transfer',billType:'transfer',destinationAccountId:savings.id});s=await get();const moving=s.recurringEntries.find(r=>r.name==='Monthly transfer');
await post({...account('Savings','EUR'),id:savings.id},400);
const movingPayment={...payment,requestId:crypto.randomUUID(),recurringEntryId:moving.id,amount:1000};await post(movingPayment);await post(movingPayment);s=await get();const legs=s.transactions.filter(t=>t.name==='Monthly transfer');assert.equal(legs.length,2);assert.equal(legs[0].amount+legs[1].amount,0);assert.equal(legs[0].transferId,legs[1].transferId);
await post({action:'setSplit',id:legs[0].id,amount:legs[0].amount,lines:[{name:'A',amount:-600},{name:'B',amount:-400}]},400);
await post({action:'deleteAccount',id:savings.id},409);
// Round-trip every new table, remapping all IDs and links to the new owner.
const backup={format:'sure-sites',version:3,...s},restore={sourceFormat:'sites',content:JSON.stringify(backup),mode:'replace'};let p=await migrate({...restore,action:'preview'},200,other);assert.equal(p.counts.recurringAllocations,s.recurringAllocations.length);assert.equal(p.counts.splitLines,2);
await migrate({...restore,action:'commit',receipt:p.receipt,expectedRevision:p.expectedRevision,confirmation:'REPLACE'},200,other);
const copied=await get(other);assert.equal(copied.recurringAllocations.length,s.recurringAllocations.length);assert.ok(copied.recurringAllocations.every(a=>a.ownerId===other&&copied.recurringOccurrences.some(o=>o.id===a.occurrenceId)));assert.ok(copied.splitLines.every(l=>copied.transactions.some(t=>t.id===l.transactionId)));assert.ok(copied.recurringEntries.every(r=>!s.recurringEntries.some(old=>old.id===r.id)));
// Metadata deletions unlink all affected tables without losing transactions or payments.
await post({action:'deleteTag',id:tag.id});await post({action:'deleteMerchant',id:merchant.id});s=await get();assert.ok([...s.transactions,...s.splitLines,...s.recurringEntries].every(r=>!r.tagIds.includes(tag.id)&&r.merchantId===null));
await post({action:'clearSplit',id:purchase.id});s=await get();assert.equal(s.splitLines.length,0);assert.equal(s.transactions.find(t=>t.id===purchase.id).amount,-1000);
await post(split,404); // Deleted labels are rejected, with no partial mutation.
assert.equal((await get()).splitLines.length,0);
// Native Sure recurrence and split-linked payment data survive a real D1 restore.
const fixture=readFileSync(new URL('./fixtures/sure-v2.ndjson',import.meta.url),'utf8')+readFileSync(new URL('./fixtures/sure-recurring.ndjson',import.meta.url),'utf8');
const native={sourceFormat:'sure',content:fixture,exportDate:'2026-02-28',mode:'replace'};p=await migrate({...native,action:'preview'});assert.equal(p.counts.recurringEntries,2);assert.equal(p.counts.recurringAllocations,2);
await migrate({...native,action:'commit',receipt:p.receipt,expectedRevision:p.expectedRevision,confirmation:'REPLACE',acknowledgeWarnings:true});s=await get();assert.equal(s.recurringEntries.find(r=>r.billType==='transfer').status,'paused');assert.ok(s.recurringAllocations.find(a=>a.splitLineId));const suggestion=s.recurringAllocations.find(a=>a.state==='suggested');await post({action:'confirmAllocation',id:suggestion.id});s=await get();assert.equal(s.recurringAllocations.find(a=>a.id===suggestion.id).state,'confirmed');
const splitPayment=s.recurringAllocations.find(a=>a.splitLineId);await post({action:'deleteTransaction',id:splitPayment.transactionId});s=await get();assert.ok(s.recurringAllocations.every(a=>a.transactionId===null&&a.splitLineId===null));
mkdirSync('outputs',{recursive:true});writeFileSync('outputs/ledger-proof.json',JSON.stringify({owner,state:s}));
console.log(`Passed ${requests} ledger API checks: metadata isolation, atomic splits, CSV labels, recurring partial/link/cash payments, idempotency, history preservation, transfers, backup remapping, and native recurrence restore.`);
