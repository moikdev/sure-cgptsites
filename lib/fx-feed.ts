import {z} from 'zod';
import {parseExactProviderJSON} from './provider-json.ts';
import {CURRENCIES,validDate,today,type Currency,type FinanceState} from './finance.ts';
import {canonicalRate,FX_SCALE} from './fx.ts';
import {decimalAtoms,decimalString,pow10,roundDivide} from './decimal.ts';
import {decimalSource} from './decimal-source.ts';
import {csvDigest} from './csv-digest.ts';
import type {ExchangeRate} from './fx-types.ts';
import {validateWorkspace} from './workspace.ts';
export const FX_FEED_PROVIDER='frankfurter-v2',FX_FEED_MAX_DAYS=10000,FX_FEED_MAX_BODY=2*1024*1024,FX_FEED_MAX_SOURCE=5*1024*1024,FX_FEED_MAX_MANIFEST=8*1024*1024;
const date=z.string().refine(validDate,'Choose a valid calendar date.');
export const fxFeedOptionsSchema=z.object({fromCurrency:z.enum(CURRENCIES),toCurrency:z.enum(CURRENCIES),startDate:date,endDate:date}).strict().superRefine((v,c)=>{if(v.fromCurrency===v.toCurrency)c.addIssue({code:'custom',message:'Identity conversions do not need fetched rates.'});if(v.startDate>v.endDate||dayDistance(v.startDate,v.endDate)>=FX_FEED_MAX_DAYS)c.addIssue({code:'custom',message:'Choose an ordered range of at most 10,000 calendar days.'});});
export type FxFeedOptions=z.infer<typeof fxFeedOptionsSchema>;
export type FxFeedPolicy='keep'|'replace';
export const dayDistance=(a:string,b:string)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
export const addFeedDays=(day:string,n:number)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export function feedOptions(input:unknown,asOf=today()){const v=fxFeedOptionsSchema.parse(input);if(v.endDate>asOf)throw Error('Fetch only through today in UTC.');return v;}
export const feedFetchStart=(o:FxFeedOptions)=>o.startDate<'1900-01-06'?'1900-01-01':addFeedDays(o.startDate,-5);
export function frankfurterURL(o:FxFeedOptions){const url=new URL('https://api.frankfurter.dev/v2/rates');url.searchParams.set('base',o.fromCurrency);url.searchParams.set('quotes',o.toCurrency);url.searchParams.set('from',feedFetchStart(o));url.searchParams.set('to',o.endDate);return url.href;}
export interface FxFeedSource {format:'sure-frankfurter-source';version:1;id:string;options:FxFeedOptions;url:string;fetchedAt:string;rawSha256:string;rawBytes:number;body:string;}
export interface FxFeedIssue {row:number|null;date:string|null;reason:string;}
export interface FxFeedObservation {date:string;rate:string;rawRate:string;sourceRow:number;}
export function parseFrankfurter(body:string,o:FxFeedOptions){
 if(new TextEncoder().encode(body).length>FX_FEED_MAX_BODY)throw Error('Frankfurter response exceeds 2 MiB.');
 let data:unknown;try{data=parseExactProviderJSON(body,'Frankfurter');}catch(e){throw Error('Frankfurter returned invalid or unsupported JSON: '+(e as Error).message);}
 if(!Array.isArray(data)||data.length>20010)throw Error('Frankfurter must return a bounded array of daily rate records.');
 const rows:FxFeedObservation[]=[],issues:FxFeedIssue[]=[],seen=new Map<string,FxFeedObservation>();
 for(const [i,value] of data.entries()){
  const fail=(reason:string,date:string|null=null)=>issues.push({row:i+1,date,reason});
  if(!value||typeof value!=='object'||Array.isArray(value)){fail('Rate row is not an object.');continue;}
  const row=value as Record<string,unknown>;
  if(typeof row.base!=='string'||row.base.toUpperCase()!==o.fromCurrency||typeof row.quote!=='string'||row.quote.toUpperCase()!==o.toCurrency){fail('Rate row has a different currency pair.');continue;}
  if(typeof row.date!=='string'||!validDate(row.date)||row.date<feedFetchStart(o)||row.date>o.endDate){fail('Rate row has an invalid or out-of-request date.');continue;}
  let rate:string;try{if(typeof row.rate!=='string'||row.rate.length>2000)throw Error();rate=canonicalRate(decimalSource(row.rate));}catch{fail('Rate is not a positive exact decimal within the supported range/precision.',row.date);continue;}
  const parsed={date:row.date,rate,rawRate:row.rate,sourceRow:i+1},previous=seen.get(parsed.date);
  if(previous)fail(previous.rate===rate?'Repeated date: the final equal observation is used.':'Conflicting repeated date: the final valid observation is used, matching Sure.',row.date);
  seen.set(parsed.date,parsed);
 }
 rows.push(...[...seen.values()].sort((a,b)=>a.date.localeCompare(b.date)));return {rows,issues,rawRows:data.length};
}
export const fxFeedSourceSchema=z.object({format:z.literal('sure-frankfurter-source'),version:z.literal(1),id:z.string().uuid(),options:fxFeedOptionsSchema,url:z.string(),fetchedAt:z.string().datetime(),rawSha256:z.string().regex(/^[a-f0-9]{64}$/),rawBytes:z.number().int().min(2).max(FX_FEED_MAX_BODY),body:z.string().max(FX_FEED_MAX_BODY)}).strict();
export async function validateFeedSource(value:unknown){const s=fxFeedSourceSchema.parse(value),bytes=new TextEncoder().encode(s.body);if(s.url!==frankfurterURL(s.options)||bytes.length!==s.rawBytes||await csvDigest(bytes)!==s.rawSha256)throw Error('The saved provider source identity or checksum changed.');feedOptions(s.options);parseFrankfurter(s.body,s.options);return s;}
export async function fetchFrankfurter(id:string,input:unknown,fetcher:typeof fetch=fetch,signal?:AbortSignal,timeout=20000):Promise<FxFeedSource>{
 const options=feedOptions(input),url=frankfurterURL(options),controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,timeout);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();let response:Response|undefined;
 try{
  response=await fetcher(url,{method:'GET',headers:{Accept:'application/json'},redirect:'manual',signal:controller.signal});
  if(!response.ok){await response.body?.cancel();throw Error('Frankfurter returned HTTP '+response.status+'. Retry later or choose another supported pair/date range.');}
  if(!/^application\/(?:[a-z0-9.+-]*\+)?json(?:;|$)/i.test(response.headers.get('content-type')??'')){await response.body?.cancel();throw Error('Frankfurter did not return JSON.');}
  if(!response.body)throw Error('Frankfurter returned an empty body.');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>FX_FEED_MAX_BODY)throw Error('Frankfurter response exceeds 2 MiB.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let cursor=0;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.length;}
  const body=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);parseFrankfurter(body,options);
  return {format:'sure-frankfurter-source',version:1,id,options,url,fetchedAt:new Date().toISOString(),rawSha256:await csvDigest(bytes),rawBytes:size,body};
 }catch(e){if(controller.signal.aborted)throw Error('Frankfurter fetch was cancelled or exceeded its time limit.');throw e;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
export interface FxFeedRow {date:string;fromCurrency:Currency;toCurrency:Currency;direction:'forward'|'inverse';candidateRate:string;action:'insert'|'replace'|'unchanged'|'keep';before:{id:string;rate:string}|null;after:{id:string;rate:string};source:'provider'|'database'|'carry'|'inverse';sourceDate:string;sourceRow:number|null;notesPolicy:'created'|'preserved';}
export async function feedRateId(sourceId:string,from:Currency,to:Currency,date:string){const h=await csvDigest(JSON.stringify(['fx-feed-v1',sourceId,from,to,date]));return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);}
export async function planFxFeed(state:FinanceState,source:FxFeedSource,policy:FxFeedPolicy='keep',inverse=true){
 const o=source.options,{rows:observations,issues:sourceIssues,rawRows}=parseFrankfurter(source.body,o),issues=[...sourceIssues],dates=Array.from({length:dayDistance(o.startDate,o.endDate)+1},(_,i)=>addFeedDays(o.startDate,i)),existing=new Map(state.exchangeRates.map(r=>[r.fromCurrency+':'+r.toCurrency+':'+r.date,r])),byDate=new Map(observations.map(r=>[r.date,r])),rows:FxFeedRow[]=[],changes:ExchangeRate[]=[],unfilled:string[]=[];
 const key=(from:Currency,to:Currency,date:string)=>from+':'+to+':'+date;
 const propose=async(date:string,from:Currency,to:Currency,rate:string,direction:FxFeedRow['direction'],kind:FxFeedRow['source'],originDate:string,sourceRow:number|null)=>{
  const before=existing.get(key(from,to,date)),action=before?(before.rate===rate?'unchanged':policy==='keep'?'keep':'replace'):'insert',id=before?.id??await feedRateId(source.id,from,to,date),afterRate=action==='keep'?before!.rate:rate;
  const notes='Frankfurter v2 reference rate; fetched '+source.fetchedAt+'; '+kind+'; API/source date '+originDate+'; source '+source.id;
  if(action==='insert'||action==='replace')changes.push(before?{...before,rate:afterRate}:{id,ownerId:state.profile!.ownerId,date,fromCurrency:from,toCurrency:to,rate:afterRate,notes});
  const row:FxFeedRow={date,fromCurrency:from,toCurrency:to,direction,candidateRate:rate,action,before:before?{id:before.id,rate:before.rate}:null,after:{id,rate:afterRate},source:kind,sourceDate:originDate,sourceRow,notesPolicy:before?'preserved':'created'};rows.push(row);return row;
 };
 if(observations.length){
  const anchor=[...observations].reverse().find(r=>r.date<=o.startDate),dbStart=existing.get(key(o.fromCurrency,o.toCurrency,o.startDate));
  let previous=anchor?.rate??dbStart?.rate??null,originDate=anchor?.date??o.startDate,originRow=anchor?.sourceRow??null;
  const loopStart=previous?o.startDate:observations[0].date;
  for(const date of dates){
   const provider=byDate.get(date),db=existing.get(key(o.fromCurrency,o.toCurrency,date));let selected:FxFeedRow|null=null;
   if(date<loopStart){if(db)selected=await propose(date,o.fromCurrency,o.toCurrency,db.rate,'forward','database',date,null);else unfilled.push(date);}
   else{
    const rate=provider?.rate??db?.rate??previous;
    if(!rate){unfilled.push(date);continue;}
    const kind=provider?'provider':db?'database':'carry',day=provider?.date??(db?date:originDate),index=provider?.sourceRow??(db?null:originRow);
    selected=await propose(date,o.fromCurrency,o.toCurrency,rate,'forward',kind,day,index);
    previous=selected.after.rate;
    if(selected.action==='keep'&&selected.before?.rate!==rate){originDate=date;originRow=null;}else{originDate=day;originRow=index;}
   }
   if(selected&&inverse){
    try{const rate=canonicalRate(decimalString(roundDivide(pow10(FX_SCALE+12),decimalAtoms(selected.after.rate,FX_SCALE)),12));await propose(date,o.toCurrency,o.fromCurrency,rate,'inverse','inverse',selected.action==='keep'?date:selected.sourceDate,selected.action==='keep'?null:selected.sourceRow);}
    catch{issues.push({row:null,date,reason:'No inverse proposed: reciprocal is zero at 12 decimals or outside the supported range.'});}
   }
  }
 }else{issues.push({row:null,date:null,reason:'No valid provider observations were returned. No quotes or inverses are proposed.'});unfilled.push(...dates.filter(date=>!existing.has(key(o.fromCurrency,o.toCurrency,date))));}
 const replacements=new Map(changes.map(r=>[r.id,r])),next={...state,exchangeRates:state.exchangeRates.map(r=>replacements.get(r.id)??r).concat(changes.filter(r=>!existing.has(key(r.fromCurrency,r.toCurrency,r.date))))};validateWorkspace({...next,budgets:[]});
 const counts={inserted:rows.filter(r=>r.action==='insert').length,updated:rows.filter(r=>r.action==='replace').length,unchanged:rows.filter(r=>r.action==='unchanged').length,kept:rows.filter(r=>r.action==='keep').length,carried:rows.filter(r=>r.direction==='forward'&&r.source==='carry').length,unfilled:unfilled.length,total:rows.length,sourceRows:rawRows,validObservations:observations.length,issues:issues.length};
 return {next,changes,rows,issues,unfilled,counts,policy,inverse,options:o,source:{id:source.id,url:source.url,fetchedAt:source.fetchedAt,rawSha256:source.rawSha256,rawBytes:source.rawBytes}};
}
export type FxFeedPlan=Awaited<ReturnType<typeof planFxFeed>>;
