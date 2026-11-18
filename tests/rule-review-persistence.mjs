import {localFetch as fetch} from './local-http.mjs';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const p=JSON.parse(readFileSync('outputs/rule-review-proof.json','utf8')),origin='http://127.0.0.1:8799',hash=b=>createHash('sha256').update(b).digest('hex');
async function call(path,body,user=p.owner,raw=false){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json','oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'},...(body?{body:JSON.stringify(body)}:{})});assert.equal(r.status,200,await r.clone().text());assert.match(r.headers.get('cache-control'),/no-store/);return raw?Buffer.from(await r.arrayBuffer()):r.json();}
for(const entry of [{owner:p.owner,state:p.state},...p.additional])assert.deepEqual(await call('/api/finance',undefined,entry.owner),entry.state);
const stamp=r=>({expectedRevision:r.expectedRevision,receipt:r.receipt});
assert.deepEqual(await call('/api/rule-review',{mode:'review',...stamp(p.pending)}),p.pending);
assert.deepEqual(await call('/api/rule-review',{mode:'review',offset:18950,...stamp(p.pending)}),p.pendingLast);
assert.equal(hash(await call('/api/rule-review',{mode:'export',...stamp(p.pending)},p.owner,true)),p.pendingCsvSHA256);
assert.deepEqual(await call('/api/rule-review',{mode:'review',ignoreLocks:true,...stamp(p.splitPending)},p.splitOwner),p.splitPending);
assert.equal(hash(await call('/api/rule-review',{mode:'export',ignoreLocks:true,...stamp(p.splitPending)},p.splitOwner,true)),p.splitCsvSHA256);
console.log('PASS fresh Worker complete rule review: seven exact owner graphs, 19,000-root approved finance, current pending first/final review pages, original approval receipt semantics, exact full CSV bytes and persisted split/ZIP recovery.');
