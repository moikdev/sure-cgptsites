import {localFetch as fetch} from './local-http.mjs';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const p=JSON.parse(readFileSync('outputs/portfolio-return-proof.json','utf8')),origin='http://127.0.0.1:8799';
async function get(path,user,raw=false){const response=await fetch(origin+path,{headers:{'oai-authenticated-user-id':user,'oai-authenticated-user-email':user+'@example.test'}});assert.equal(response.status,200);return raw?Buffer.from(await response.arrayBuffer()).toString('utf8'):response.json();}
for(const item of [{owner:p.owner,state:p.state},{owner:p.other,state:p.otherState},...p.additional])assert.deepEqual(await get('/api/finance',item.owner),item.state);
for(const item of [{owner:p.owner,options:p.options,report:p.report,csv:p.csv},p.large,p.blocked,p.ambiguous]){
 const path='/api/portfolio-return?'+new URLSearchParams(item.options);assert.deepEqual(await get(path,item.owner),item.report);
 if(item.csv)assert.equal(await get(path+'&format=csv',item.owner,true),item.csv);
 if(item.last)assert.deepEqual(await get(path+(item===p.large?'&offset=19000':'&issueOffset=25'),item.owner),item.last);
}
console.log('PASS fresh-Worker complete finance, exact return reports/CSV and final pages, 19,002-flow graph, blocked observations and multiple-root warnings');
