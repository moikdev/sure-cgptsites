// Run transport-compatible suites sequentially; --http requires one loopback Worker.
import {localFetch} from './local-http.mjs';
const direct=['api','migration','backup-archive','native-merge','native-source','native-revert','recurring-lifecycle','transfer-auto'];
const http=['transfer-hints','files','paycheck','transfer-counterpart','receipts','category-csv','transfer-classification','recurring-matcher','transfer-settings','recurring-prices','loans','transfer-match','zero-entries','transfer-kind-repair','qif-imports'];
const original=globalThis.fetch;globalThis.fetch=localFetch;
try{for(const file of process.argv.includes('--http')?http:direct){await import('./'+file+'.integration.mjs');console.log('PASS archive regression suite '+file);}}finally{globalThis.fetch=original;}
