// One Worker at a time: direct runner for default mode, HTTP Worker for --http.
import {localFetch} from './local-http.mjs';
const direct=['api','migration','backup-archive','native-merge','native-source','native-revert','native-merge-graphs','recurring-lifecycle','transfer-auto','cashflow-report','monthly-breakdown','spending-comparison','net-worth-report','account-archive','budget','goals','goal-fx','budget-fx','fx','investment-fx','native-fx','market-fx','portfolio','rules','contributions'];
const http=['transfer-hints','files','paycheck','transfer-counterpart','receipts','category-csv','transfer-classification','recurring-matcher','transfer-settings','recurring-prices','loans','transfer-match','zero-entries','transfer-kind-repair','qif-imports'];
const original=globalThis.fetch;globalThis.fetch=localFetch;
const selected=process.argv.includes('--http')?http:direct,from=process.argv.find(v=>v.startsWith('--from='))?.slice(7),start=from?selected.indexOf(from):0;if(start<0)throw Error('Unknown regression start');
try{for(const file of selected.slice(start)){await import('./'+file+'.integration.mjs');console.log('PASS account-details regression suite '+file);}}finally{globalThis.fetch=original;}
