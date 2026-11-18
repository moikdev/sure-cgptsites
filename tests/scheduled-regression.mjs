import {localFetch} from './local-http.mjs';const original=globalThis.fetch;globalThis.fetch=localFetch;
try{for(const file of ['api','migration','backup-archive','portfolio','market-fx','net-worth-report','value-accounting','credit-card','manual-asset']){await import('./'+file+'.integration.mjs');console.log('PASS scheduled projection regression '+file);}}finally{globalThis.fetch=original;}
