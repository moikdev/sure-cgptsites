import {TRADE_SOURCE_LABELS} from './trade-activity.ts';
import {INVESTMENT_ACTIVITY_LABELS} from './investment-reporting-schema.ts';
import {decimalAtoms,quantityValue,QTY_SCALE,safeMinorUnits} from './decimal.ts';
import {precision,today,validDate,type Currency,type FinanceState} from './finance.ts';
import {toCSV} from './csv.ts';
import type {TradeActivity} from './investment-types.ts';

export const FLOW_CLASSES=['external_inflow','external_outflow','income','fee','internal'] as const;
export type FlowClass=typeof FLOW_CLASSES[number];
export const FLOW_LABELS=INVESTMENT_ACTIVITY_LABELS;
export type FlowLabel=typeof FLOW_LABELS[number];
export const flowClassNames:Record<FlowClass,string>={external_inflow:'External inflow',external_outflow:'External outflow',income:'Investment income',fee:'Fee or rebate',internal:'Internal movement'};
export interface FlowInput {type:'trade'|'transaction'|'valuation';excluded?:boolean;pending?:boolean;label?:FlowLabel|null;kind?:string;feeLeg?:boolean;cashAmount:number;qty?:string;accountId:string;counterpartAccountId?:string|null;securityCounterpartAccountIds?:string[];}
export function classifyPortfolioFlow(input:FlowInput,scope:ReadonlySet<string>):{classification:FlowClass|null;reason:string}{
 if(input.excluded)return {classification:null,reason:'Excluded entry.'};
 if(input.type==='valuation')return {classification:null,reason:'A balance observation is not a flow.'};
 if(input.type==='transaction'&&input.pending)return {classification:null,reason:'Pending cash entry.'};
 if(input.type==='transaction'&&input.feeLeg&&input.kind==='standard')return {classification:'fee',reason:'Separate fee leg of a linked transfer.'};
 const direction=():FlowClass=>input.type==='trade'?decimalAtoms(input.qty??'0',QTY_SCALE)<0n?'external_outflow':'external_inflow':input.cashAmount>0?'external_inflow':'external_outflow';
 const linked=()=>!!input.counterpartAccountId&&scope.has(input.counterpartAccountId);
 if(input.label==='Dividend'||input.label==='Interest')return {classification:'income',reason:`${input.label} label; signed charges and reversals are retained.`};
 if(input.label==='Fee')return {classification:'fee',reason:'Fee label; signed rebates are retained.'};
 if(['Buy','Sell','Reinvestment','Sweep In','Sweep Out','Exchange'].includes(input.label??''))return {classification:'internal',reason:`${input.label} is internal in the source flow classifier.`};
 if(input.type==='trade'){
  if(input.label==='Contribution'||input.label==='Withdrawal')return {classification:direction(),reason:'Security flow direction follows its signed quantity.'};
  if(input.label==='Transfer'){const match=(input.securityCounterpartAccountIds??[]).some(id=>id!==input.accountId&&scope.has(id));return {classification:match?'internal':direction(),reason:match?'Opposite-quantity Transfer trade in another scoped account on the same security and date.':'No opposite-quantity Transfer trade in another scoped account on this security and date.'};}
  return {classification:'internal',reason:'Trade fallback: no external-flow label is recorded.'};
 }
 if(input.label==='Contribution'||input.label==='Withdrawal'||input.label==='Transfer'||['funds_movement','cc_payment','loan_payment','investment_contribution'].includes(input.kind??''))return {classification:linked()?'internal':direction(),reason:linked()?'Linked counterpart account is inside this report scope.':'Linked counterpart is absent or outside this report scope.'};
 return {classification:direction(),reason:'Unlabelled cash flow follows its signed amount.'};
}
const labels=TRADE_SOURCE_LABELS;
export interface PortfolioFlowOptions {currency:Currency;from:string;to:string;accountId?:string;}
export interface PortfolioFlowRow {id:string;source:'transaction'|'trade';accountId:string;accountName:string;date:string;name:string;currency:Currency;classification:FlowClass|null;reason:string;activity:string;cashAmount:number;securityId:string|null;ticker:string|null;qty:string|null;recordedSecurityValue:number;counterpartAccountIds:string[];}
export interface FlowTotals {count:number;cashIn:number;cashOut:number;netCash:number;securityIn:number;securityOut:number;netRecordedSecurityValue:number;}
export function createPortfolioFlowReport(state:FinanceState,options:PortfolioFlowOptions){
 if(!validDate(options.from)||!validDate(options.to)||options.from>options.to||options.to>today())throw new Error('Choose a valid date range through today.');
 const eligible=state.accounts.filter(a=>['investment','crypto'].includes(a.type)&&a.currency===options.currency);
 if(options.accountId&&!eligible.some(a=>a.id===options.accountId))throw new Error('Investment account not found in this currency.');
 const accounts=eligible.filter(a=>options.accountId?a.id===options.accountId:!a.excludedFromReports),scope=new Set(accounts.map(a=>a.id)),accountMap=new Map(accounts.map(a=>[a.id,a])),securities=new Map(state.securities.map(s=>[s.id,s]));
 const pairIndex=new Map<string,Set<string>>(),cashGroups=new Map<string,typeof state.transactions>(),feeIds=new Set(state.transferFees.map(f=>f.transactionId));
 for(const trade of state.trades)if(!trade.excluded&&scope.has(trade.accountId)&&['transfer_in','transfer_out'].includes(trade.activity)){const key=JSON.stringify([trade.securityId,trade.date,decimalAtoms(trade.qty,QTY_SCALE).toString()]),ids=pairIndex.get(key)??new Set<string>();ids.add(trade.accountId);pairIndex.set(key,ids);}
 for(const entry of state.transactions)if(entry.transferId){const group=cashGroups.get(entry.transferId)??[];group.push(entry);cashGroups.set(entry.transferId,group);}
 const rows:PortfolioFlowRow[]=[];
 for(const trade of state.trades){const account=accountMap.get(trade.accountId);if(!account||trade.date<options.from||trade.date>options.to||trade.date<account.openingDate)continue;
  const counterpartAccountIds=labels[trade.activity]==='Transfer'?[...(pairIndex.get(JSON.stringify([trade.securityId,trade.date,(-decimalAtoms(trade.qty,QTY_SCALE)).toString()]))??[])].filter(id=>id!==trade.accountId):[],classified=classifyPortfolioFlow({type:'trade',excluded:!!trade.excluded,label:labels[trade.activity],qty:trade.qty,cashAmount:trade.cashAmount,accountId:trade.accountId,securityCounterpartAccountIds:counterpartAccountIds},scope);
  rows.push({id:trade.id,source:'trade',accountId:account.id,accountName:account.name,date:trade.date,name:trade.name,currency:account.currency,...classified,activity:trade.activity,cashAmount:trade.cashAmount,securityId:trade.securityId,ticker:securities.get(trade.securityId)?.ticker??null,qty:trade.qty,recordedSecurityValue:quantityValue(trade.qty,trade.price,precision(account.currency)),counterpartAccountIds});
 }
 for(const entry of state.transactions){const account=accountMap.get(entry.accountId);if(!account||entry.date<options.from||entry.date>options.to||entry.date<account.openingDate)continue;
  const counterpart=entry.transferId?cashGroups.get(entry.transferId)?.find(other=>other.id!==entry.id):undefined,classified=classifyPortfolioFlow({type:'transaction',label:entry.investmentActivity,excluded:!!entry.excluded,kind:entry.kind,feeLeg:feeIds.has(entry.id),cashAmount:entry.amount,accountId:entry.accountId,counterpartAccountId:counterpart?.accountId},scope);
  rows.push({id:entry.id,source:'transaction',accountId:account.id,accountName:account.name,date:entry.date,name:entry.name,currency:account.currency,...classified,activity:entry.investmentActivity??entry.kind,cashAmount:entry.amount,securityId:null,ticker:null,qty:null,recordedSecurityValue:0,counterpartAccountIds:counterpart&&scope.has(counterpart.accountId)?[counterpart.accountId]:[]});
 }
 rows.sort((a,b)=>b.date.localeCompare(a.date)||a.source.localeCompare(b.source)||a.id.localeCompare(b.id));
 const totals=Object.fromEntries([...FLOW_CLASSES,'excluded'].map(kind=>{const selected=rows.filter(row=>(row.classification??'excluded')===kind),sum=(pick:(row:PortfolioFlowRow)=>number)=>safeMinorUnits(selected.reduce((value,row)=>value+BigInt(pick(row)),0n));return [kind,{count:selected.length,cashIn:sum(row=>Math.max(0,row.cashAmount)),cashOut:sum(row=>Math.max(0,-row.cashAmount)),netCash:sum(row=>row.cashAmount),securityIn:sum(row=>Math.max(0,row.recordedSecurityValue)),securityOut:sum(row=>Math.max(0,-row.recordedSecurityValue)),netRecordedSecurityValue:sum(row=>row.recordedSecurityValue)}];})) as Record<FlowClass|'excluded',FlowTotals>;
 const unclassified=rows.filter(row=>row.classification!==null&&['unclassified','cash'].includes(row.activity)).length,observations=state.valuations.filter(row=>scope.has(row.accountId)&&row.date>=options.from&&row.date<=options.to).length+state.investmentCashBalances.filter(row=>scope.has(row.accountId)&&row.date>=options.from&&row.date<=options.to).length+state.holdingSnapshots.filter(row=>scope.has(row.accountId)&&row.date>=options.from&&row.date<=options.to).length;
 const warnings=[...(unclassified?[`${unclassified} imported or generic cash activity row(s) have no source activity label. They use the source classifier’s internal fallback; classify their actual activity before relying on income or external-flow totals.`]:[]),...(observations?[`${observations} balance or holding observation(s) are excluded from flow totals. Opening and observed balances are not inferred deposits.`]:[]),'Recorded security values use each trade’s stored native unit price. They are separate from cash, are not an execution price guarantee, and do not establish transferred-in cost basis.','Unlabelled cash entries fall back to their recorded kind and transfer link. The pinned native Sure v2 export omits activity labels and trade exclusions; they are not guessed on import.'];
 return {options,revision:state.profile?.revision??0,accounts:accounts.map(a=>({id:a.id,name:a.name,archived:!!a.archived,excludedFromReports:!!a.excludedFromReports})),totals,warnings,unclassified,observations,rows};
}
export type PortfolioFlowReport=ReturnType<typeof createPortfolioFlowReport>;
export function portfolioFlowPage(report:PortfolioFlowReport,offset=0,classification:FlowClass|'excluded'|'all'='all'){
 if(!Number.isSafeInteger(offset)||offset<0||offset>40000||!['all','excluded',...FLOW_CLASSES].includes(classification))throw new Error('Choose supported flow page options.');
 const filtered=report.rows.filter(row=>classification==='all'||(row.classification??'excluded')===classification);return {...report,rows:filtered.slice(offset,offset+25),page:{offset,limit:25,total:filtered.length,allRows:report.rows.length,classification}};
}
export function portfolioFlowCSV(report:PortfolioFlowReport){return toCSV([['date','account','currency','source','name','classification','activity','cash_minor_units','security','signed_shares','recorded_security_value_minor_units','reason'],...report.rows.map(row=>[row.date,row.accountName,row.currency,row.source,row.name,row.classification??'excluded',row.activity,row.cashAmount,row.ticker??'',row.qty??'',row.recordedSecurityValue,row.reason])]);}
