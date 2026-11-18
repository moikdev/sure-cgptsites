import {z} from 'zod';
import {CURRENCIES,type Account,type FinanceState} from './finance.ts';
import {csvDigest} from './csv-digest.ts';
import {canonicalCSVAccountMappings,csvAccountMappingsSchema,type CSVAccountMappings} from './csv-account-mapping.ts';
import {mappedInvestmentCSVTable,type InvestmentCSVOptions,type InvestmentCSVKind,type InvestmentCSVLimits,DIRECT_INVESTMENT_LIMITS} from './investment-csv-mapping.ts';
export {csvAccountMappingsSchema};
export const investmentAccountCreationsSchema=z.array(z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(160).refine(v=>!v.includes('\0'),'Account names cannot contain NUL bytes.'),currency:z.enum(CURRENCIES),type:z.enum(['investment','crypto'])}).strict()).min(1).max(500).superRefine((rows,ctx)=>{if(new Set(rows.map(r=>r.id)).size!==rows.length||new Set(rows.map(r=>r.name)).size!==rows.length)ctx.addIssue({code:'custom',message:'Give each proposed account a distinct name and identifier.'});});
export type InvestmentAccountCreations=z.infer<typeof investmentAccountCreationsSchema>;
export interface InvestmentAccountInput {kind:InvestmentCSVKind;accountId:string|null;accountMappings?:CSVAccountMappings;accountCreations?:InvestmentAccountCreations;requestId?:string;}
export interface TradeCSVAccountSource {sourceName:string;currencies:string[];rows:number;firstDate:string;}
const text=(table:string[][],row:string[],field:string)=>row[table[0].indexOf(field)]?.trim()??'';
export function tradeCSVAccountSources(table:string[][],mapped:boolean){
 if(!mapped)throw new Error('Map the CSV account column before mapping trade accounts.');const sources=new Map<string,TradeCSVAccountSource>();
 for(const row of table.slice(1)){const name=text(table,row,'account'),currency=text(table,row,'currency').toUpperCase(),date=text(table,row,'date');if(name.length>255||name.includes('\0'))throw new Error('CSV account labels must fit 255 characters without NUL bytes.');const source=sources.get(name)??{sourceName:name,currencies:[],rows:0,firstDate:date};source.rows++;if(currency&&!source.currencies.includes(currency))source.currencies.push(currency);if(date<source.firstDate)source.firstDate=date;sources.set(name,source);}
 return [...sources.values()].sort((a,b)=>a.sourceName<b.sourceName?-1:a.sourceName>b.sourceName?1:0);
}
export function investmentCSVAccountSources(csv:string,options:InvestmentCSVOptions,limits:InvestmentCSVLimits=DIRECT_INVESTMENT_LIMITS){return tradeCSVAccountSources(mappedInvestmentCSVTable(csv,'trades',options,limits).table,options.columns.account!==undefined);}
async function accountId(owner:string,requestId:string,proposalId:string){const h=await csvDigest(JSON.stringify(['investment-csv-account-v1',owner,requestId,proposalId]));return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
export async function prepareInvestmentAccounts(state:FinanceState,input:InvestmentAccountInput,table:string[][],hasAccountColumn:boolean){
 if(input.requestId)z.string().uuid().parse(input.requestId);const mapped=input.kind==='trades'&&input.accountId===null;
 if(!mapped){if(input.accountMappings!==undefined||input.accountCreations!==undefined)throw new Error('Account mappings are only available for multi-account trade imports.');return {mapped:false as const,accounts:state.accounts,newAccounts:[] as Account[],mappings:[] as CSVAccountMappings,sources:[] as TradeCSVAccountSource[]};}
 if(!state.profile)throw new Error('Create your workspace first.');const mappings=canonicalCSVAccountMappings(csvAccountMappingsSchema.parse(input.accountMappings)),sources=tradeCSVAccountSources(table,hasAccountColumn),names=new Set(sources.map(s=>s.sourceName));
 if(mappings.length!==names.size||mappings.some(m=>!names.has(m.sourceName)))throw new Error('Map every CSV account label exactly once and remove unused mappings.');
 const creations=input.accountCreations===undefined?[]:investmentAccountCreationsSchema.parse(input.accountCreations);if(creations.length&&!input.requestId)throw new Error('A new-account import needs a request identifier.');if(input.requestId)z.string().uuid().parse(input.requestId);
 const referenced=new Set(mappings.map(m=>m.accountId));if(creations.some(c=>!referenced.has(c.id)))throw new Error('Every proposed account must be used by a CSV account mapping.');
 const accounts=[...state.accounts],newAccounts:Account[]=[],targets=new Map<string,Account>();
 for(const c of creations){const id=await accountId(state.profile.ownerId,input.requestId!,c.id);if(state.accounts.some(a=>a.id===c.id))throw new Error('A proposed account identifier collides with an existing account.');const byId=accounts.find(a=>a.id===id),same=accounts.filter(a=>a.name===c.name);if(byId&&(byId.name!==c.name||byId.currency!==c.currency||byId.type!==c.type||byId.archived))throw new Error('This proposed account identifier was already used with different details.');if(!byId&&same.length>1)throw new Error('A proposed account name is ambiguous. Select an existing account explicitly.');const existing=byId??same[0];if(existing){if(existing.archived||existing.type!==c.type||existing.currency!==c.currency)throw new Error('An account with this name already exists with another type/currency or is archived. Select an existing account explicitly.');targets.set(c.id,existing);continue;}
  const labels=new Set(mappings.filter(m=>m.accountId===c.id).map(m=>m.sourceName)),dates=sources.filter(s=>labels.has(s.sourceName)).map(s=>s.firstDate).sort();const account:Account={id,ownerId:state.profile.ownerId,name:c.name,type:c.type,currency:c.currency,openingDate:dates[0],openingBalance:0,archived:0,excludedFromReports:0,cashPlanningExcluded:null,loanTerms:null,loanReplay:null};accounts.push(account);newAccounts.push(account);targets.set(c.id,account);
 }
 if(accounts.length>500)throw new Error('This import would exceed the 500-account workspace limit.');const resolved=mappings.map(m=>({...m,accountId:targets.get(m.accountId)?.id??m.accountId}));for(const mapping of resolved){const account=accounts.find(a=>a.id===mapping.accountId);if(!account||account.archived||!['investment','crypto'].includes(account.type))throw new Error('Map every CSV label to an owned active investment or crypto account.');}
 return {mapped:true as const,accounts,newAccounts,mappings:resolved,sources};
}
