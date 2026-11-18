import {z} from 'zod';
import {parseCSV,toCSV} from './csv.ts';
import {websiteSchema} from './ledger-schema.ts';
import {csvDigest} from './csv-digest.ts';
import type {Merchant} from './finance.ts';

export const MERCHANT_CSV_BYTES=10*1024*1024;
export const merchantDelimiter=z.enum([',',';','\t','|']);
export interface MerchantCSVRow {
  row:number; name:string; action:'create'|'reuse'|'blank';
  merchant:Merchant|null; defaultColor:boolean; normalizedWebsite:boolean;
}
const normalizeHeader=(value:string)=>value.trim().toLowerCase().replaceAll('*','').replace(/[\s-]+/g,'_');

export async function planMerchantCSV(csv:string,delimiter:z.infer<typeof merchantDelimiter>,existing:Merchant[],owner:string,seed:string){
  const [header,...rows]=parseCSV(csv,delimiter);
  if(!header?.length||header.length>100)throw new Error('Choose a CSV with 1–100 headers.');
  const headers=header.map(normalizeHeader);
  if(new Set(headers).size!==headers.length)throw new Error('Merchant CSV headers must be unique after removing stars and normalizing spaces and hyphens.');
  const nameIndex=headers.indexOf('name'),colorIndex=headers.indexOf('color');
  const websiteIndex=['website_url','website'].map(key=>headers.indexOf(key)).find(index=>index>=0)??-1;
  if(nameIndex<0)throw new Error('Merchant CSV needs a name column.');
  if(!rows.length||rows.length>10000)throw new Error('Import between 1 and 10,000 merchant rows.');
  // Older port workspaces may contain duplicate merchant names. Keep every
  // existing record and reuse the same stable exact-name target in each review.
  const byName=new Map<string,Merchant>();
  for(const merchant of [...existing].sort((a,b)=>a.id.localeCompare(b.id)))if(!byName.has(merchant.name))byName.set(merchant.name,merchant);
  const created:Merchant[]=[],review:MerchantCSVRow[]=[];
  for(const [index,values] of rows.entries()){
    const row=index+2;
    if(values.length!==header.length)throw new Error(`Row ${row}: column count does not match the header.`);
    const name=values[nameIndex].trim();
    if(!name){review.push({row,name,action:'blank',merchant:null,defaultColor:false,normalizedWebsite:false});continue;}
    const found=byName.get(name);
    if(found){review.push({row,name,action:'reuse',merchant:found,defaultColor:false,normalizedWebsite:false});continue;}
    if(name.length>160||name==='__no_merchant__')throw new Error(`Row ${row}: choose a merchant name of at most 160 characters, excluding the reserved no-merchant label.`);
    const rawColor=values[colorIndex]?.trim()??'',defaultColor=!/^#[a-fA-F0-9]{6}$/.test(rawColor),color=defaultColor?'#e99537':rawColor;
    const rawWebsite=values[websiteIndex]?.trim()??'',normalizedWebsite=!!rawWebsite&&!/^[a-z][a-z0-9+.-]*:/i.test(rawWebsite);
    const website=normalizedWebsite?'https://'+rawWebsite:rawWebsite;
    const parsed=(()=>{try{return websiteSchema.safeParse(website||null);}catch{return {success:false as const};}})();
    if(!parsed.success)throw new Error(`Row ${row}: use an HTTP or HTTPS merchant website without credentials, up to 2,000 characters.`);
    const hash=await csvDigest(JSON.stringify(['merchant-csv-v1',owner,seed,name]));
    const merchant:Merchant={id:`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`,ownerId:owner,name,color,websiteUrl:parsed.data};
    byName.set(name,merchant);created.push(merchant);
    review.push({row,name,action:'create',merchant,defaultColor,normalizedWebsite});
  }
  if(existing.length+created.length>5000)throw new Error('This import would exceed 5,000 merchants in your workspace.');
  if(new Set([...existing,...created].map(m=>m.id)).size!==existing.length+created.length)throw new Error('A proposed merchant identifier already exists. Restage this file.');
  return {rows:review,created,total:review.length,reused:review.filter(r=>r.action==='reuse').length,blank:review.filter(r=>r.action==='blank').length};
}

export function merchantsCSV(merchants:readonly Merchant[]){
  return toCSV([['name','color','website_url'],...[...merchants].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).map(m=>[m.name,m.color,m.websiteUrl??''])]);
}
