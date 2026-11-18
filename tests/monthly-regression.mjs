import {localFetch} from './local-http.mjs';
const originalFetch=globalThis.fetch;globalThis.fetch=localFetch;
try{for(const test of ['./spending-comparison.integration.mjs','./budget-fx.integration.mjs','./fx.integration.mjs'])await import(test);}finally{globalThis.fetch=originalFetch;}
console.log('PASS existing spending, budget-FX and FX API suites sequentially');
