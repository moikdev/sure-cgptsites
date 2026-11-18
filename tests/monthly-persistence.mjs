import {localFetch} from './local-http.mjs';
const originalFetch=globalThis.fetch;globalThis.fetch=localFetch;
try{await import('./monthly-breakdown-persistence.mjs');await import('./spending-comparison-persistence.mjs');await import('./persistence.mjs');}finally{globalThis.fetch=originalFetch;}
