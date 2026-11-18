import {localFetch as fetch} from './local-http.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const p=JSON.parse(readFileSync('outputs/rule-regex-proof.json','utf8')),origin='http://127.0.0.1:8799',hash=s=>createHash('sha256').update(s).digest('hex');
async function call(path,body,user=p.owner,raw=false){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200,await r.clone().text());assert.match(r.headers.get('cache-control'),/no-store/);return raw?Buffer.from(await r.arrayBuffer()):r.json();}
for(const entry of [{owner:p.owner,state:p.state},...p.additional])assert.deepEqual(await call('/api/finance',undefined,entry.owner),entry.state);
assert.deepEqual(await call('/api/finance',p.pendingCommand),p.pending);
assert.deepEqual(await call('/api/csv-imports?id='+p.largeId+'&offset=9975'),p.largeLast);assert.equal(p.largeLast.rows.at(-1).transaction.name,'CAFÉ 9999');
for(const [path,sha] of [['/api/csv-imports?id='+p.largeId+'&format=csv',p.largeSHA256],['/api/rule-imports?id='+p.ruleId+'&format=csv',p.ruleSourceSHA256],['/api/rule-imports?id='+p.foreignId+'&format=csv',p.foreignSourceSHA256],['/api/rule-imports?format=rules',p.exportedRulesSHA256]])assert.equal(hash(await call(path,undefined,p.owner,true)),sha,path);
assert.deepEqual(await call('/api/rule-imports?id='+p.foreignId),p.foreignReview);
console.log('PASS fresh Worker regex rules: five exact owner graphs, raw patterns/locks and run history, native disabled originals, ZIP-remapped 10,000-row finance, pending history/source reviews, complete final source page and exact originals/exports.');
