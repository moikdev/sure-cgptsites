import {localFetch as fetch} from './local-http.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
const origin='http://127.0.0.1:8799',owner='csv-mapping-'+crypto.randomUUID(),other='csv-mapping-'+crypto.randomUUID();let checks=0;
async function call(body,status=200,user=owner,extra={}){
 checks++;const response=await fetch(origin+'/api/finance',{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':`${user}@example.test`}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));assert.match(response.headers.get('cache-control'),/no-store/);return data;
}
const get=(user=owner)=>call(null,200,user),post=(body,status=200,user=owner)=>call(body,status,user);
const sql=command=>JSON.parse(execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',command,'--json'],{encoding:'utf8',stdio:'pipe'}));
await call({action:'import',csv:'x'},401,null);await call({action:'import',csv:'x'},403,owner,{Origin:'https://attacker.invalid'});
await post({action:'initialize',name:'Mapped CSV',currency:'USD'});await post({action:'initialize',name:'Other',currency:'USD'},200,other);
const account=(name,currency='USD')=>({action:'account',name,type:'checking',currency,openingBalance:100000,openingDate:'2026-01-01'});
await post(account('Checking'));await post(account('Yen','JPY'));await post(account('Other'),200,other);
await post({action:'tag',name:'Work',color:'#123456'});await post({action:'merchant',name:'Market',color:'#123456',websiteUrl:null});
let state=await get();const a=state.accounts.find(a=>a.name==='Checking'),yen=state.accounts.find(a=>a.currency==='JPY'),foreign=(await get(other)).accounts[0];
const csvOptions={delimiter:';',dateFormat:'dmy',numberFormat:'decimal-comma',amountMode:'signed',signage:'outflows-positive',columns:{date:0,name:1,amount:2,category:3,notes:4,merchant:5,tags:6,excluded:7,kind:8,currency:9,account:10,reconciled_status:11}};
const csv='Posted;Description;Value;Group;Memo;Seller;Labels;Hidden;Reporting;CCY;Ledger;Status\r\n01/02/2026;Cafe;1.234,56;Groceries;Original note;Market;"[""Work""]";true;one_time;USD;Checking;cleared\r\n02/02/2026;Pay;-2.000,00;;;;;false;standard;USD;Checking;unreconciled';
const command={action:'import',accountId:a.id,csv,csvOptions};
await post({...command,accountId:foreign.id},404);await post(command,404,other);
assert.match((await post(command)).message,/Imported 2 transactions/);
state=await get();const cafe=state.transactions.find(t=>t.name==='Cafe'),pay=state.transactions.find(t=>t.name==='Pay');assert.equal(cafe.amount,-123456);assert.equal(pay.amount,200000);assert.equal(cafe.date,'2026-02-01');assert.equal(cafe.kind,'one_time');assert.equal(cafe.excluded,1);assert.equal(cafe.notes,'Original note');assert.equal(cafe.reconciledStatus,'cleared');assert.equal(cafe.merchantId,state.merchants[0].id);assert.deepEqual(cafe.tagIds,[state.tags[0].id]);assert.equal(cafe.categoryId,state.categories.find(c=>c.name==='Groceries').id);assert.ok(cafe.importKey);
assert.match((await post(command)).message,/Imported 0 transactions. Skipped 2/);assert.deepEqual(await get(),state);
// Different layout and sign conventions normalize to the same original fingerprint.
const legacy='date,name,amount,notes,kind\n2026-02-01,Cafe,-1234.56,Original note,one_time\n2026-02-02,Pay,2000.00,,standard';
assert.match((await post({action:'import',accountId:a.id,csv:legacy})).message,/Imported 0 transactions/);assert.deepEqual(await get(),state);
const split={delimiter:'\t',dateFormat:'mdy',numberFormat:'decimal-dot',amountMode:'split',signage:'outflows-positive',columns:{date:2,name:0,debit:3,credit:1}};
const splitCSV='Text\tMoney in\tWhen\tMoney out\nDuplicate\t\t02/03/2026\t0.29\nDuplicate\t\t02/03/2026\t0.29\nRefund\t1.23\t02/04/2026\t';
assert.match((await post({action:'import',accountId:a.id,csv:splitCSV,csvOptions:split})).message,/Imported 3/);
state=await get();const duplicates=state.transactions.filter(t=>t.name==='Duplicate');assert.equal(duplicates.length,2);assert.notEqual(duplicates[0].importKey,duplicates[1].importKey);assert.ok(duplicates.every(t=>t.amount===-29));assert.equal(state.transactions.find(t=>t.name==='Refund').amount,123);
assert.match((await post({action:'import',accountId:a.id,csv:splitCSV,csvOptions:split})).message,/Imported 0/);assert.deepEqual(await get(),state);
const simple={delimiter:';',dateFormat:'dmy',numberFormat:'decimal-comma',amountMode:'signed',signage:'outflows-positive',columns:{date:0,name:1,amount:2}};
for(const bad of ['31/02/2026;Bad;1,00','03/02/2026;Bad;1,234','03/02/2026;Bad;not-a-number','03/02/2026;;1,00','03/02/2026;Bad;1,00;extra','31/12/2025;Bad;1,00']){
 await post({action:'import',accountId:a.id,csv:'When;Name;Value\n03/02/2026;Valid first row;1,00\n'+bad,csvOptions:simple},400);assert.deepEqual(await get(),state);
}
for(const patch of [{columns:{date:0,name:0,amount:2}},{columns:{date:0,name:1,amount:5}},{columns:{date:0,name:1}},{numberFormat:'auto'},{delimiter:':'},{amountMode:'split'},{extra:true}]){await post({action:'import',accountId:a.id,csv:'When;Name;Value\n03/02/2026;Bad;1,00',csvOptions:{...simple,...patch}},400);assert.deepEqual(await get(),state);}
for(const [field,value] of [['category','Missing category'],['currency','JPY'],['account','Other account'],['kind','funds_movement'],['tags','not-json'],['reconciled_status','verified']]){
 const configured={...simple,columns:{...simple.columns,[field]:3}};
 await post({action:'import',accountId:a.id,csv:'When;Name;Value;Extra\n03/02/2026;Valid;1,00;\n04/02/2026;Bad;2,00;'+value,csvOptions:configured},400);assert.deepEqual(await get(),state);
}
await post({action:'import',accountId:a.id,csv:'Date\tName\tOut\tIn\n02/03/2026\tValid\t1.00\t\n02/04/2026\tBad\t2.00\t3.00',csvOptions:{...split,columns:{date:0,name:1,debit:2,credit:3}}},400);assert.deepEqual(await get(),state);
// Automatic rules still run atomically on the normalized rows; retries use original keys.
await post({action:'rule',name:'Mapped automatic rule',active:1,position:1,group:'CSV',effectiveDate:null,currency:'USD',stopProcessing:0,conditions:[{field:'name',operator:'like',value:'mapped rule'}],actions:[{type:'name',value:'Renamed by automatic rule'},{type:'categoryId',value:state.categories.find(c=>c.name==='Groceries').id}],blockedReason:null,sourceJson:null});
const ruled={action:'import',accountId:a.id,csv:'When;Text;Money\n05/02/2026;Mapped rule purchase;0,29',csvOptions:simple};
assert.match((await post(ruled)).message,/Rules updated 1/);state=await get();const renamed=state.transactions.find(t=>t.name==='Renamed by automatic rule');assert.equal(renamed.amount,-29);assert.ok(renamed.categoryId);assert.ok(renamed.importKey);assert.match((await post(ruled)).message,/Imported 0/);assert.deepEqual(await get(),state);
// A real late insert failure must roll back earlier inserts and the revision.
sql(`CREATE TRIGGER csv_mapping_forced_failure BEFORE INSERT ON transactions WHEN NEW.owner_id='${owner}' AND NEW.name='Atomic failure' BEGIN SELECT RAISE(ABORT,'forced CSV integration failure'); END;`);
try {await post({action:'import',accountId:a.id,csv:'When;Text;Money\n06/02/2026;Atomic first row;1,00\n07/02/2026;Atomic failure;2,00',csvOptions:simple},500);assert.deepEqual(await get(),state);}finally{sql('DROP TRIGGER csv_mapping_forced_failure');}
assert.match((await post({action:'import',accountId:yen.id,csv:'Date|Name|Amount\n2026-02-08|Yen purchase|1,234',csvOptions:{...simple,delimiter:'|',dateFormat:'ymd',numberFormat:'integer-comma'}})).message,/Imported 1/);
state=await get();assert.equal(state.transactions.find(t=>t.name==='Yen purchase').amount,-1234);
await post({action:'import',accountId:yen.id,csv:'Date;Name;Amount\n08/02/2026;Yen fraction;1,23',csvOptions:simple},400);assert.deepEqual(await get(),state);
assert.equal((await get(other)).transactions.length,0);
mkdirSync('outputs',{recursive:true});writeFileSync('outputs/csv-mapping-proof.json',JSON.stringify({owner,state},null,2));console.log(`${checks} mapped CSV API checks passed`);
