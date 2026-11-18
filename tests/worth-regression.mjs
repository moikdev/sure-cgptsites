// Run the original loan-principal suite separately against its loopback HTTP Worker.
import {localFetch} from './local-http.mjs';
const originalFetch=globalThis.fetch;globalThis.fetch=localFetch;
try{for(const file of ['./cashflow-report.integration.mjs','./monthly-breakdown.integration.mjs','./spending-comparison.integration.mjs','./portfolio.integration.mjs','./investment-fx.integration.mjs','./market-fx.integration.mjs','./fx.integration.mjs','./budget-fx.integration.mjs'])await import(file);}finally{globalThis.fetch=originalFetch;}
console.log('PASS existing report, portfolio, investment FX, market pricing and FX/budget FX suites sequentially');
