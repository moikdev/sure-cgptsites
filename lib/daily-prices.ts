import {CURRENCIES,today,validDate,type Currency,type FinanceState} from './finance.ts';
import {csvDigest} from './csv-digest.ts';
import {parseCSV} from './csv.ts';
import {tradeAccountChanges,tradePositionChanges} from './trade-csv-plan.ts';
import {transferReportingEffects} from './transfer-report-effects.ts';
import {validateWorkspace} from './workspace.ts';
export const DAILY_PRICE_LIMIT=1000;
export interface DailyPriceError {index:number|null;message:string;}
export interface DailyPriceRow {index:number;date:string;price:string;currency:Currency;}
/** Finite BigDecimal input forms, normalized with integer arithmetic and bounded expansion. */
export function parseDailyClose(value:unknown):string{
 const text=(typeof value==='string'||typeof value==='number'?String(value):'').trim();
 if(text==='NaN'||text==='-Infinity')throw new Error('price must be greater than 0');if(text==='Infinity'||text==='+Infinity')throw new Error('price is too large');
 const digits='\\d(?:_?\\d)*',grammar=new RegExp(`^[+-]?(?:(?:${digits}(?:\\.(?:${digits})?)?|\\.${digits})(?:[eE][+-]?${digits})?|${digits}_)$`);
 if(text.length>256||!grammar.test(text))throw new Error('price must be a number');
 const m=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(text.replaceAll('_',''))!,fraction=m[3]??m[4]??'';let coefficient=((m[2]??'')+fraction).replace(/^0+/,'');
 if(m[1]==='-'||!coefficient)throw new Error('price must be greater than 0');
 let scale=BigInt(fraction.length)-BigInt(m[5]??0);while(coefficient.endsWith('0')){coefficient=coefficient.slice(0,-1);scale--;}
 if(scale>4n)throw new Error('price must have at most 4 decimal places');if(BigInt(coefficient.length)-scale>15n)throw new Error('price is too large');
 if(scale<=0n)return coefficient+'0'.repeat(Number(-scale));const places=Number(scale),padded=coefficient.padStart(places+1,'0');return padded.slice(0,-places)+'.'+padded.slice(-places);
}
export function dailyPriceCurrencyPolicy(state:FinanceState,securityId:string){
 const existing=[...new Set(state.securityPrices.filter(p=>p.securityId===securityId).map(p=>p.currency))].sort(),trades=[...new Set(state.trades.filter(t=>t.securityId===securityId).map(t=>t.currency))].sort(),holdings=[...new Set(state.holdingSnapshots.filter(h=>h.securityId===securityId).map(h=>h.currency))].sort();
 if(existing.length){const sentence=existing.length<3?existing.join(' or '):existing.slice(0,-1).join(', ')+' or '+existing.at(-1);return {currencies:existing,source:'prices' as const,error:null,message:`currency must be ${sentence}, the ${existing.length===1?'currency':'currencies'} of this security's prices`};}
 const currencies=trades.length?trades:holdings,source=trades.length?'trades' as const:'holdings' as const;
 if(!currencies.length)return {currencies,source,error:'no trade or holding of this security records a currency, so none can be chosen for its prices',message:''};
 if(currencies.length>1)return {currencies,source,error:`this security's ${source} are in more than one currency (${currencies.join(', ')}); none can be chosen for its prices`,message:''};
 return {currencies,source,error:null,message:`currency must be ${currencies[0]}, the currency of your ${source} in this security`};
}
export function validateDailyPrices(state:FinanceState,securityId:string,rows:readonly unknown[],asOf=today()){
 const policy=dailyPriceCurrencyPolicy(state,securityId),security=state.securities.find(s=>s.id===securityId),errors:DailyPriceError[]=[],parsed:DailyPriceRow[]=[],seen=new Set<string>();
 if(!rows.length)return {policy,parsed,errors:[{index:null,message:'prices must contain at least one row'}]};if(rows.length>DAILY_PRICE_LIMIT)return {policy,parsed,errors:[{index:null,message:`a request can carry at most ${DAILY_PRICE_LIMIT} prices`}]};
 if(!security)throw new Error('Security not found.');if(security.kind==='cash')return {policy,parsed,errors:[{index:null,message:'prices cannot be imported for a cash position'}]};
 for(const [index,input] of rows.entries()){
  if(!input||typeof input!=='object'||Array.isArray(input)){errors.push({index,message:'row must be an object with date, price and currency'});continue;}
  const row=input as Record<string,unknown>,date=typeof row.date==='string'?row.date:'',currency=typeof row.currency==='string'?row.currency.trim().toUpperCase():'',dateError=!/^\d{4}-\d{2}-\d{2}$/.test(date)||!validDate(date)?'date must be an ISO 8601 date':date>asOf?'date must not be in the future':null;let price='',priceError:string|null=null;try{price=parseDailyClose(row.price);}catch(e){priceError=(e as Error).message;}
  const message=dateError??priceError??(!CURRENCIES.includes(currency as Currency)?'currency must be an ISO 4217 code':seen.has(date)?'date appears more than once in this batch':null);
  if(message)errors.push({index,message});else{seen.add(date);parsed.push({index,date,price,currency:currency as Currency});}
 }
 if(parsed.length){if(policy.error)errors.push({index:null,message:policy.error});else for(const row of parsed){if(!policy.currencies.includes(row.currency))errors.push({index:row.index,message:policy.message});else if(row.currency!==parsed[0].currency)errors.push({index:row.index,message:'every row in one request must use the same currency'});}}
 errors.sort((a,b)=>(a.index??-1)-(b.index??-1));return {policy,parsed,errors};
}
export function dailyPriceCSV(text:string){if(new TextEncoder().encode(text).length>512000||text.includes('\0'))throw new Error('Use a price table up to 512 KB without NUL characters.');const table=parseCSV(text),header=table.shift()?.map(v=>v.trim().toLowerCase());if(!header||header.length!==3||new Set(header).size!==3||!['date','price','currency'].every(k=>header.includes(k)))throw new Error('Use exactly date,price,currency as the three CSV headers.');if(table.length>DAILY_PRICE_LIMIT)throw new Error('Enter at most 1,000 daily prices.');return table.map((row,i)=>{if(row.length!==3)throw new Error(`Row ${i+2}: use three CSV fields.`);return Object.fromEntries(header.map((key,j)=>[key,row[j].trim()]));});}
export async function planDailyPrices(state:FinanceState,securityId:string,rows:readonly unknown[],asOf=today()){
 if(!state.profile)throw new Error('Create your workspace first.');if(!validDate(asOf))throw new Error('Choose a valid review date.');
 const validation=validateDailyPrices(state,securityId,rows,asOf),security=state.securities.find(s=>s.id===securityId)!;
 if(validation.errors.length)return {ready:false as const,...validation,security,reviewedOn:asOf};
 const next=structuredClone(state),changes=[] as {index:number;id:string;date:string;currency:Currency;before:string|null;after:string;operation:'create'|'update'|'unchanged'}[];
 for(const row of validation.parsed){const existing=next.securityPrices.find(p=>p.securityId===securityId&&p.date===row.date&&p.currency===row.currency),h=existing?null:await csvDigest(JSON.stringify(['daily-price-v1',state.profile.ownerId,state.profile.revision,securityId,row.date,row.currency])),id=existing?.id??`${h!.slice(0,8)}-${h!.slice(8,12)}-5${h!.slice(13,16)}-8${h!.slice(17,20)}-${h!.slice(20,32)}`,operation=!existing?'create':existing.price===row.price?'unchanged':'update';changes.push({index:row.index,id,date:row.date,currency:row.currency,before:existing?.price??null,after:row.price,operation});if(existing)existing.price=row.price;else next.securityPrices.push({id,ownerId:state.profile.ownerId,securityId,date:row.date,price:row.price,currency:row.currency});}
 const written=changes.filter(c=>c.operation!=='unchanged'),first=written.map(c=>c.date).sort()[0],related=[...new Set([...state.trades,...state.holdingSnapshots].filter(r=>r.securityId===securityId).map(r=>r.accountId))],affected=first?related:[],entries=[...state.trades,...state.holdingSnapshots].filter(r=>r.securityId===securityId),statements=first?next.accountStatements.filter(s=>s.completedAt&&s.periodEnd>=first&&entries.some(e=>e.accountId===s.accountId&&e.date<=s.periodEnd)):[];
 for(const s of statements)s.reviewRequired=1;
 try{validateWorkspace({...next,budgets:[]});}catch(e){return {ready:false as const,...validation,errors:[{index:null,message:(e as Error).message}],security,reviewedOn:asOf};}
 return {ready:true as const,...validation,security,reviewedOn:asOf,next,changes,created:changes.filter(c=>c.operation==='create').length,updated:changes.filter(c=>c.operation==='update').length,unchanged:changes.filter(c=>c.operation==='unchanged').length,accounts:tradeAccountChanges(state,next,affected,asOf).map(a=>({...a,archived:!!state.accounts.find(x=>x.id===a.id)?.archived})),positions:tradePositionChanges(state,next,affected,asOf),closedStatements:statements.map(s=>({id:s.id,title:s.title})),effects:first?transferReportingEffects(state,next,affected.map(accountId=>({accountId,date:first})),affected,asOf):[],startDate:validation.parsed.map(r=>r.date).sort()[0],endDate:validation.parsed.map(r=>r.date).sort().at(-1)!};
}
export function dailyPricePage(plan:Awaited<ReturnType<typeof planDailyPrices>>,offset=0,accountOffset=0,positionOffset=0,effectOffset=0){for(const n of [offset,accountOffset,positionOffset,effectOffset])if(!Number.isSafeInteger(n)||n<0||n>40000||n%25)throw new Error('Choose a supported price review page.');if(!plan.ready)return {ready:false as const,security:plan.security,reviewedOn:plan.reviewedOn,policy:plan.policy,errors:plan.errors,errorCount:plan.errors.length};return {ready:true as const,security:plan.security,reviewedOn:plan.reviewedOn,policy:plan.policy,errors:[],errorCount:0,created:plan.created,updated:plan.updated,unchanged:plan.unchanged,startDate:plan.startDate,endDate:plan.endDate,rows:plan.changes.slice(offset,offset+25),page:{offset,limit:25,total:plan.changes.length},accounts:plan.accounts.slice(accountOffset,accountOffset+25),accountPage:{offset:accountOffset,limit:25,total:plan.accounts.length},positions:plan.positions.slice(positionOffset,positionOffset+25),positionPage:{offset:positionOffset,limit:25,total:plan.positions.length},effects:plan.effects.slice(effectOffset,effectOffset+25),effectPage:{offset:effectOffset,limit:25,total:plan.effects.length},closedStatements:plan.closedStatements,notes:['Daily closes apply to every owned account holding this security, including archived accounts. Same-date observations retain the existing portfolio precedence and split-adjusted price rules.','Only price history is written. Recorded cash, trades, share quantities, cost-basis evidence, goals and contribution checkpoints remain.','Missing foreign exchange rates or unsafe calculated values block this operation. Completed statements listed here require review.']};}
