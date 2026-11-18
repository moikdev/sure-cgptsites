import {z} from 'zod';
import {CURRENCIES,today,type FinanceState} from './finance.ts';
import {csvDigest} from './csv-digest.ts';
import {investmentImportRows} from './investment-csv.ts';
import {investmentCSVOptionsSchema,createInvestmentCSVTemplate,STAGED_TRADE_LIMITS} from './investment-csv-mapping.ts';
import {csvAccountMappingsSchema,investmentAccountCreationsSchema} from './investment-import-accounts.ts';
import {validateWorkspace} from './workspace.ts';
import {accountPositions,investmentAccountBalance} from './portfolio.ts';
import {sumMinorUnits} from './finance.ts';
import {transferReportingEffects} from './transfer-report-effects.ts';
export const tradeCSVOptionsSchema=z.object({accountId:z.string().uuid().nullable(),currency:z.enum(CURRENCIES),csvOptions:investmentCSVOptionsSchema,accountMappings:csvAccountMappingsSchema.optional(),accountCreations:investmentAccountCreationsSchema.optional()}).strict().superRefine((v,ctx)=>{if(v.accountId===null&&(!v.accountMappings||v.csvOptions.columns.account===undefined))ctx.addIssue({code:'custom',message:'Map the account column and every source label for a multi-account trade file.'});if(v.accountId!==null&&(v.accountMappings||v.accountCreations))ctx.addIssue({code:'custom',message:'Use one selected account or explicit CSV account mappings.'});if(JSON.stringify(v).length>500000)ctx.addIssue({code:'custom',message:'Trade CSV settings exceed the supported size.'});});
export type TradeCSVOptions=z.infer<typeof tradeCSVOptionsSchema>;
export function canonicalTradeCSVOptions(input:unknown){const options=tradeCSVOptionsSchema.parse(input);options.accountMappings?.sort((a,b)=>a.sourceName<b.sourceName?-1:a.sourceName>b.sourceName?1:0);options.accountCreations?.sort((a,b)=>a.id.localeCompare(b.id));return options;}
export async function tradeCSVIdentity(seed:string){const h=await csvDigest(JSON.stringify(['trade-csv-cycle-v1',seed]));return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
const balance=(state:FinanceState,id:string,asOf:string)=>{const a=state.accounts.find(a=>a.id===id);return a?investmentAccountBalance(a,state,asOf):{cash:0,holdings:0,total:0};};
export function tradeAccountChanges(before:FinanceState,after:FinanceState,ids:string[],asOf:string){return [...new Set(ids)].map(id=>{const a=after.accounts.find(a=>a.id===id)??before.accounts.find(a=>a.id===id)!;return {id,name:a.name,currency:a.currency,created:!before.accounts.some(a=>a.id===id),removed:!after.accounts.some(a=>a.id===id),before:balance(before,id,asOf),after:balance(after,id,asOf)};});}
export function tradePositionChanges(before:FinanceState,after:FinanceState,ids:string[],asOf:string){
 const changes=[] as {accountId:string;accountName:string;securityId:string;ticker:string;exchange:string;currency:FinanceState['accounts'][number]['currency'];before:ReturnType<typeof summary>|null;after:ReturnType<typeof summary>|null}[];
 function summary(p:ReturnType<typeof accountPositions>[number]){return {qty:p.qty,price:p.price,value:p.value,cost:p.cost,averageCost:p.averageCost,unrealized:p.unrealized,unknownBasis:p.unknownBasis,realized:sumMinorUnits(p.disposals.map(d=>d.gain??0)),unknownDisposals:p.disposals.filter(d=>d.gain===null).length};}
 for(const id of new Set(ids)){const a=before.accounts.find(a=>a.id===id),b=after.accounts.find(a=>a.id===id),old=new Map((a?accountPositions(before,a,asOf):[]).map(p=>[p.securityId,summary(p)])),next=new Map((b?accountPositions(after,b,asOf):[]).map(p=>[p.securityId,summary(p)]));for(const securityId of new Set([...old.keys(),...next.keys()])){const x=old.get(securityId)??null,y=next.get(securityId)??null;if(JSON.stringify(x)===JSON.stringify(y))continue;const security=before.securities.find(s=>s.id===securityId)??after.securities.find(s=>s.id===securityId)!;changes.push({accountId:id,accountName:(b??a)!.name,securityId,ticker:security.ticker,exchange:security.exchange,currency:(b??a)!.currency,before:x,after:y});}}
 return changes;
}
export async function planTradeCSV(state:FinanceState,csv:string,raw:unknown,seed:string,reviewedOn=today()){
 const options=canonicalTradeCSVOptions(raw);if(csv.includes('\0')||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(csv))throw new Error('Choose a UTF-8 CSV without NUL bytes or invalid Unicode.');
 const result=await investmentImportRows(state,{kind:'trades',csv,...options,requestId:await tradeCSVIdentity(seed)},true),next={...state,accounts:[...state.accounts,...result.newAccounts],trades:[...state.trades,...result.trades]},data=validateWorkspace({...next,budgets:[]}),ids=[...new Set(result.reviewRows.map(r=>r.trade.accountId))];
 const template=createInvestmentCSVTemplate(csv,'trades',options.csvOptions,STAGED_TRADE_LIMITS),changes=result.trades.map(t=>({accountId:t.accountId,date:t.date}));
 return {result,next,data,template,total:result.reviewRows.length,reviewedOn,accounts:tradeAccountChanges(state,next,ids,reviewedOn),positions:tradePositionChanges(state,next,ids,reviewedOn),effects:changes.length?transferReportingEffects(state,next,changes,ids,reviewedOn):[]};
}
