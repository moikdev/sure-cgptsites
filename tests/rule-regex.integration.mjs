import {localFetch as fetch} from './local-http.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {toCSV} from '../lib/csv.ts';
import {readBackupArchive} from '../lib/backup-archive.ts';
const origin='http://127.0.0.1:8799',owner='regex-'+crypto.randomUUID(),other='regex-'+crypto.randomUUID(),copyOwner='regex-'+crypto.randomUUID();let checks=0;
async function call(path,body,status=200,user=owner,{method=body===undefined?'GET':'POST',raw=false,headers={},responseStatus=false}={}){
 checks++;const r=await fetch(origin+path,{method,headers:{Origin:origin,'Content-Type':method==='PUT'?'text/csv':'application/json',...(user?{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}:{}),...headers},...(body===undefined?{}:{body:method==='PUT'?body:JSON.stringify(body)})});
 assert.ok((Array.isArray(status)?status:[status]).includes(r.status),checks+' '+path+': '+((Array.isArray(status)?status:[status]).includes(r.status)?'':await r.text()));assert.match(r.headers.get('cache-control'),/no-store/);return raw?r:responseStatus?{status:r.status,data:await r.json()}:r.json();
}
const post=(c,status=200,user=owner)=>call('/api/finance',c,status,user),get=(user=owner)=>call('/api/finance',undefined,200,user),api=(path,c,status=200,user=owner)=>call(path,c,status,user),hash=s=>createHash('sha256').update(s).digest('hex');
const sql=command=>execFileSync(process.execPath,['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to','.wrangler/state','--command',command,'--json'],{encoding:'utf8',stdio:'pipe'});
const leaf=(value,field='name')=>({field,operator:'matches_regex',value}),rule=(name,conditions,actions,patch={})=>({action:'rule',name,active:1,position:1,group:'Regex',currency:null,effectiveDate:null,stopProcessing:0,conditions,actions,blockedReason:null,sourceJson:null,...patch});
await call('/api/finance',undefined,401,null);
for(const u of [owner,other,copyOwner])await post({action:'initialize',name:'Regex rules',currency:'USD'},200,u);
await post({action:'account',name:'Checking',type:'checking',currency:'USD',openingBalance:100000,openingDate:'2026-01-01'});
await post({action:'tag',name:'Regex match',color:'#123456'});
let s=await get(),account=s.accounts[0],category=s.categories.find(c=>c.name==='Groceries'),tag=s.tags[0];
const base=rule('Notes pattern',[leaf('^First\\nSecond$','notes')],[{type:'name',value:'Matched notes'},{type:'categoryId',value:category.id}]);
await call('/api/finance',base,403,owner,{headers:{Origin:'https://outside.example'}});
const initial=await get();
for(const pattern of ['', 'a'.repeat(201), '(a)\\1','(?=a)','(?<=a)b','[','(a{100}){100}','\ud800','\0'])await post({...base,conditions:[leaf(pattern)]},400);
await post({...base,conditions:[{...leaf('x'),field:'accountId'}]},400);
assert.deepEqual(await get(),initial);
await post(base);s=await get();const notesRule=s.rules[0];
await post({...base,id:notesRule.id},404,other);await post({action:'ruleRun',mode:'preview',ruleId:notesRule.id},404,other);await post({action:'deleteRule',id:notesRule.id},404,other);
await post({action:'transaction',accountId:account.id,categoryId:null,date:'2026-02-01',name:'CAFÉ 123',amount:-123,kind:'standard',notes:' First\nSecond '});
s=await get();let t=s.transactions[0];assert.equal(t.notes,'First\nSecond');assert.equal(t.name,'CAFÉ 123');
let p=await post({action:'ruleRun',mode:'preview',ruleId:notesRule.id});assert.equal(p.matched,1);assert.equal(p.skipped,1);assert.equal(p.changes[0].changes.some(c=>c.field==='name'),false);assert.deepEqual(await get(),s);
await post({action:'ruleRun',mode:'commit',ruleId:notesRule.id,expectedRevision:p.expectedRevision,receipt:'0'.repeat(64)},409);
await post({action:'profile',name:'Changed review',currency:'USD'});await post({action:'ruleRun',mode:'commit',ruleId:notesRule.id,expectedRevision:p.expectedRevision,receipt:p.receipt},409);
p=await post({action:'ruleRun',mode:'preview',ruleId:notesRule.id,ignoreLocks:true});
const commit={action:'ruleRun',mode:'commit',ruleId:notesRule.id,ignoreLocks:true,expectedRevision:p.expectedRevision,receipt:p.receipt},stable=await get();
sql("CREATE TRIGGER regex_run_fault BEFORE INSERT ON rule_runs WHEN NEW.owner_id='"+owner+"' BEGIN SELECT RAISE(ABORT,'synthetic regex run fault'); END;");
try{await post(commit,500);assert.deepEqual(await get(),stable);}finally{sql('DROP TRIGGER regex_run_fault');}
const race=await Promise.all([call('/api/finance',commit,[200,409],owner,{responseStatus:true}),call('/api/finance',commit,[200,409],owner,{responseStatus:true})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);s=await get();assert.equal(s.transactions[0].name,'Matched notes');assert.equal(s.transactions[0].amount,-123);assert.equal(s.transactions[0].categoryId,category.id);assert.ok(s.transactions[0].lockedFields.includes('name'));assert.equal(s.ruleRuns.length,1);
await post({...notesRule,action:'rule',active:0});
await post(rule('Cafe pattern',[leaf('^café\\s+[0-9]+$')],[{type:'categoryId',value:category.id},{type:'tagIds',value:[tag.id]}]));
await post({action:'import',accountId:account.id,csv:'date,name,amount\n2026-02-02,CAFÉ 456,-1.00'});
s=await get();assert.equal(s.transactions.find(t=>t.date==='2026-02-02').categoryId,category.id);assert.deepEqual(s.transactions.find(t=>t.date==='2026-02-02').tagIds,[tag.id]);const count=s.transactions.length;
await post({action:'import',accountId:account.id,csv:'date,name,amount\n2026-02-02,CAFÉ 456,-1.00'});assert.equal((await get()).transactions.length,count);
// Too much matching work aborts both history runs and direct/staged CSV imports.
await post(rule('Bounded expensive pattern',[leaf('a{1000}','notes')],[{type:'excluded',value:true}]));
s=await get();const heavy=s.rules.find(r=>r.name==='Bounded expensive pattern'),badCSV=toCSV([['date','name','amount','notes'],...Array.from({length:30},(_,i)=>['2026-02-03','CAFÉ '+i,-1,'a'.repeat(1999)+'!'])]),beforeBudget=await get();
assert.match((await post({action:'import',accountId:account.id,csv:badCSV},400)).error,/run is too large/);assert.deepEqual(await get(),beforeBudget);
const options={delimiter:',',dateFormat:'ymd',numberFormat:'decimal-dot',amountMode:'signed',signage:'outflows-negative',columns:{date:0,name:1,amount:2,notes:3}};
const reserve=(csv,extra={})=>({action:'reserve',accountId:account.id,requestId:crypto.randomUUID(),filename:'regex.csv',byteSize:Buffer.byteLength(csv),sha256:hash(csv),options,...extra});
const blocked=(await api('/api/csv-imports',reserve(badCSV))).import.id;await call('/api/csv-imports?id='+blocked,badCSV,200,owner,{method:'PUT'});assert.match((await call('/api/csv-imports?id='+blocked,undefined,400)).error,/run is too large/);assert.deepEqual(await get(),beforeBudget);
await post({...heavy,action:'rule',active:0});assert.equal((await call('/api/csv-imports?id='+blocked)).imported,30);
// Real 10,000-row source, complete last review page, approval/reversal/reapproval.
const large=toCSV([['date','name','amount','notes'],...Array.from({length:10000},(_,i)=>['2026-02-04','CAFÉ '+i,-0.01,'row '+i])]),largeId=(await api('/api/csv-imports',reserve(large))).import.id;
await call('/api/csv-imports?id='+largeId,large,200,owner,{method:'PUT'});let largeReview=await call('/api/csv-imports?id='+largeId);assert.equal(largeReview.imported,10000);const final=await call('/api/csv-imports?id='+largeId+'&offset=9975');assert.equal(final.rows.length,25);assert.equal(final.rows.at(-1).transaction.name,'CAFÉ 9999');
const largeCommand=()=>({action:'commit',id:largeId,expectedRevision:largeReview.expectedRevision,receipt:largeReview.receipt,reviewedOn:largeReview.reviewedOn});
await api('/api/csv-imports',largeCommand(),404,other);await api('/api/csv-imports',{...largeCommand(),receipt:'0'.repeat(64)},409);
const beforeLarge=await get();sql("CREATE TRIGGER regex_csv_fault BEFORE UPDATE OF status ON csv_imports WHEN NEW.id='"+largeId+"' AND NEW.status='complete' BEGIN SELECT RAISE(ABORT,'synthetic regex CSV fault'); END;");
try{await api('/api/csv-imports',largeCommand(),500);assert.deepEqual(await get(),beforeLarge);}finally{sql('DROP TRIGGER regex_csv_fault');}
await api('/api/csv-imports',largeCommand());await api('/api/csv-imports',largeCommand());s=await get();assert.equal(s.transactions.length,count+10000);assert.equal(s.transactions.filter(t=>t.date==='2026-02-04'&&t.categoryId===category.id&&t.tagIds.includes(tag.id)).length,10000);
const reversal=await api('/api/csv-imports',{action:'revertPreview',id:largeId});assert.equal(reversal.ownedEntries,10000);
const revertCommand={action:'revertCommit',id:largeId,expectedRevision:reversal.expectedRevision,receipt:reversal.receipt,reviewedOn:reversal.reviewedOn,confirmation:'REVERT'};
await api('/api/csv-imports',revertCommand);await api('/api/csv-imports',revertCommand);assert.equal((await get()).transactions.length,count);largeReview=await call('/api/csv-imports?id='+largeId);await api('/api/csv-imports',largeCommand());assert.equal((await get()).transactions.length,count+10000);
// Saved rule CSV knows its dialect; foreign patterns remain disabled without it.
const ruleCSV=(trusted)=>toCSV([['name','resource_type','active','effective_date','conditions','actions','group','sure_sites_options'],['Imported regex','transaction','true','',JSON.stringify([{condition_type:'transaction_name',operator:'matches_regex',value:'^new\\s+shop$'}]),JSON.stringify([{action_type:'set_transaction_name',value:'New shop matched'}]),'',trusted?JSON.stringify({version:1,regexDialect:'re2-v1'}):'']]);
const reserveRule=(csv,allowDisabled=false)=>({action:'reserve',requestId:crypto.randomUUID(),filename:'rules.csv',byteSize:Buffer.byteLength(csv),sha256:hash(csv),options:{delimiter:',',allowDisabled}});
const foreignCSV=ruleCSV(false),foreignId=(await api('/api/rule-imports',reserveRule(foreignCSV,true))).import.id;
await call('/api/rule-imports?id='+foreignId,foreignCSV,200,owner,{method:'PUT'});const fp=await call('/api/rule-imports?id='+foreignId);assert.equal(fp.disabled,1);assert.match(fp.rows[0].blockedReason,/PostgreSQL/);
const trustedCSV=ruleCSV(true),ruleId=(await api('/api/rule-imports',reserveRule(trustedCSV))).import.id;await call('/api/rule-imports?id='+ruleId,trustedCSV,200,owner,{method:'PUT'});
let rp=await call('/api/rule-imports?id='+ruleId);assert.equal(rp.disabled,0);await api('/api/rule-imports',{action:'commit',id:ruleId,receipt:rp.receipt,expectedRevision:rp.expectedRevision});s=await get();assert.equal(s.rules.find(r=>r.name==='Imported regex').conditions[0].value,'^new\\s+shop$');
const exported=Buffer.from(await (await call('/api/rule-imports?format=rules',undefined,200,owner,{raw:true})).arrayBuffer());assert.match(exported.toString('utf8'),/re2-v1/);assert.deepEqual([...exported.subarray(0,3)],[239,187,191]);
await post({action:'import',accountId:account.id,csv:'date,name,amount\n2026-02-05,New   Shop,-1.00'});assert.equal((await get()).transactions.find(t=>t.date==='2026-02-05').name,'New shop matched');
// Full financial ZIP and native imports preserve the different dialect boundaries.
const zip=await (await call('/api/statement-files/archive',undefined,200,owner,{raw:true})).blob(),backup=await readBackupArchive(zip,'sites'),payload=JSON.parse(backup.content);assert.equal(payload.version,36);
const recovery={sourceFormat:'sites',content:backup.content,mode:'replace'},recoveryReview=await api('/api/migration',{...recovery,action:'preview'},200,copyOwner);
await api('/api/migration',{...recovery,action:'commit',receipt:recoveryReview.receipt,expectedRevision:recoveryReview.expectedRevision,confirmation:'REPLACE',acknowledgeWarnings:true},200,copyOwner);
const copy=await get(copyOwner);assert.deepEqual(copy.rules.map(r=>[r.name,r.conditions,r.active]).sort(),(await get()).rules.map(r=>[r.name,r.conditions,r.active]).sort());assert.ok(copy.rules.every(r=>r.ownerId===copyOwner));assert.equal(copy.transactions.length,(await get()).transactions.length);
const nativeContent=readFileSync(new URL('./fixtures/sure-v2.ndjson',import.meta.url),'utf8')+'\n'+JSON.stringify({type:'Rule',version:1,data:{id:'pg-regex',name:'PostgreSQL pattern',resource_type:'transaction',active:true,conditions:[{condition_type:'transaction_name',operator:'matches_regex',value:'\\mshop\\M'}],actions:[{action_type:'set_transaction_name',value:'Shop'}]}}),native={sourceFormat:'sure',content:nativeContent,exportDate:'2026-02-28',mode:'replace'};
const np=await api('/api/migration',{...native,action:'preview'},200,other);assert.ok(np.warnings.some(w=>/PostgreSQL/.test(w)));
await api('/api/migration',{...native,action:'commit',receipt:np.receipt,expectedRevision:np.expectedRevision,confirmation:'REPLACE',acknowledgeWarnings:true},200,other);const nativeState=await get(other);assert.equal(nativeState.rules[0].active,0);assert.match(nativeState.rules[0].sourceJson,/matches_regex/);
// Leave real pending reviews and exact source downloads for a fresh Worker.
// Actual history-run budget rejection and workspace-wide compile bounds.
await post({action:'import',accountId:account.id,csv:badCSV});await post({...heavy,action:'rule',active:1});const beforeHistoryBudget=await get();
assert.match((await post({action:'ruleRun',mode:'preview',ruleId:heavy.id},400)).error,/run is too large/);assert.deepEqual(await get(),beforeHistoryBudget);await post({...heavy,action:'rule',active:0});
const boundsOwner='regex-bounds-'+crypto.randomUUID(),programOwner='regex-program-'+crypto.randomUUID();
for(const user of [boundsOwner,programOwner])await post({action:'initialize',name:'Regex bounds',currency:'USD'},200,user);
for(let i=0;i<32;i++)await post(rule('Pattern '+i,[leaf('pattern'+i)],[{type:'name',value:'Changed'}],{active:0}),200,boundsOwner);
const beforePatterns=await get(boundsOwner);assert.match((await post(rule('Too many',[leaf('thirty-third')],[{type:'name',value:'Changed'}],{active:0}),400,boundsOwner)).error,/32 distinct/);assert.deepEqual(await get(boundsOwner),beforePatterns);
for(let i=0;i<8;i++)await post(rule('Program '+i,[leaf('a{1000}'+i)],[{type:'name',value:'Changed'}],{active:0}),200,programOwner);
const beforePrograms=await get(programOwner);assert.match((await post(rule('Too large',[leaf('a{1000}X')],[{type:'name',value:'Changed'}],{active:0}),400,programOwner)).error,/complex together/);assert.deepEqual(await get(programOwner),beforePrograms);
const finalReversal=await api('/api/csv-imports',{action:'revertPreview',id:largeId});await api('/api/csv-imports',{action:'revertCommit',id:largeId,expectedRevision:finalReversal.expectedRevision,receipt:finalReversal.receipt,reviewedOn:finalReversal.reviewedOn,confirmation:'REVERT'});
s=await get();const pending=await post({action:'ruleRun',mode:'preview',ruleId:notesRule.id,ignoreLocks:true}),largeLast=await call('/api/csv-imports?id='+largeId+'&offset=9975'),foreignReview=await call('/api/rule-imports?id='+foreignId);
writeFileSync('outputs/rule-regex-proof.json',JSON.stringify({owner,state:s,additional:[{owner:copyOwner,state:copy},{owner:other,state:nativeState},{owner:boundsOwner,state:beforePatterns},{owner:programOwner,state:beforePrograms}],pendingCommand:{action:'ruleRun',mode:'preview',ruleId:notesRule.id,ignoreLocks:true},pending,largeId,largeLast,largeSHA256:hash(large),ruleId,ruleSourceSHA256:hash(trustedCSV),foreignId,foreignReview,foreignSourceSHA256:hash(foreignCSV),exportedRulesSHA256:hash(exported)}));
console.log('Passed '+checks+' regex API checks: raw text, explicit dialect, private rules, immutable source/reviews, atomic rule and 10,000-row CSV approval/reversal/reapproval, budget rollback, ZIP remapping and native disabled originals.');
