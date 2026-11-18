import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {localFetch} from './local-http.mjs';
const proof=JSON.parse(readFileSync('outputs/bulk-posting-proof.json','utf8'));
for(const [owner,state] of [[proof.owner,proof.state],[proof.copy,proof.copyState]]){
 const response=await localFetch('http://127.0.0.1:8799/api/finance',{headers:{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':owner+'@example.test'}});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),state);
}
console.log('PASS fresh Worker persisted bulk posting edits and independently restored split checks.');
