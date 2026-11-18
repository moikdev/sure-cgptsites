import {money,parseMoney,type Currency,type FinanceState} from './finance.ts';
import type {WorkspaceData} from './workspace.ts';
import type {NativeMergeChange} from './native-merge.ts';
const ignored=new Set(['id','ownerId','requestId','requestFingerprint','importKey','sourceJson']);
const minor=new Set(['amount','cashAmount','fee','openingBalance','closingBalance','allocated','budgetedSpending','expectedIncome','targetAmount','previousAmount','newAmount','fromAmount','toAmount','sourceFee','destinationFee','sourceAmount','sourceCashAmount','matchedAmount','consumedAmount','snapshotOpening','snapshotClosing']);
const flags=new Set(['archived','excluded','excludedFromReports','cashPlanningExcluded','loanReplay','marketFx','active','stopProcessing','reviewRequired','autopay','costBasisLocked','securityLocked','autoTotal','rolloverEnabled']);
const titles:Record<string,string>={accountId:'Account',destinationAccountId:'Destination account',categoryId:'Category',parentId:'Parent category',merchantId:'Merchant',tagIds:'Tags',securityId:'Security',bookId:'Budget plan',periodId:'Budget period',goalId:'Goal',recurringEntryId:'Recurring schedule',occurrenceId:'Recurring occurrence',transactionId:'Transaction',fileId:'Original file',reconciledStatementId:'Reconciled statement',statementId:'Statement',lucideIcon:'Icon'};
const references=new Set([...Object.keys(titles).filter(key=>key.endsWith('Id')||key.endsWith('Ids')),'transferId','accountIds','matchedTransactionId','matchedValuationId','outflowTransactionId','inflowTransactionId','adjustmentId']);
const title=(key:string)=>titles[key]??key.replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
export function nativeMergeReview(changes:NativeMergeChange[],before:FinanceState,after:WorkspaceData){
  const names=new Map<string,string>();
  for(const data of [before,after])for(const key of ['accounts','categories','merchants','tags','securities','recurringEntries','goals','budgetBooks','accountStatements','statementFiles'] as const)for(const row of data[key]){const label=row as {id:string;name?:string;title?:string;ticker?:string;filename?:string};names.set(label.id,label.name??label.title??label.ticker??label.filename??label.id);}
  for(const data of [before,after])for(const row of data.budgetPeriods)names.set(row.id,(names.get(row.bookId)??'Budget')+' · '+row.startDate+' to '+row.endDate);
  for(const data of [before,after])for(const row of data.transactions)names.set(row.id,row.name+' · '+row.date);
  for(const data of [before,after])for(const row of data.transactions)if(row.transferId)names.set(row.transferId,'Transfer · '+data.transactions.filter(t=>t.transferId===row.transferId).map(t=>t.name).join(' / '));
  for(const data of [before,after])for(const row of data.recurringOccurrences)names.set(row.id,(names.get(row.recurringEntryId)??'Recurring schedule')+' · '+row.originalDueOn);
  const currency=(row:Record<string,unknown>)=>(row.currency??after.accounts.find(a=>a.id===row.accountId)?.currency??after.budgetPeriods.find(p=>p.id===row.periodId)?.currency??after.budgetBooks.find(b=>b.id===row.bookId)?.currency??before.profile!.currency) as Currency;
  const display=(value:unknown,key:string,row:Record<string,unknown>):string=>{
    if(value===null||value===undefined)return 'None';
    if(typeof value==='number'&&minor.has(key))return money(value,['fromAmount','sourceFee','sourceAmount','sourceCashAmount'].includes(key)?row.fromCurrency as Currency??currency(row):key==='toAmount'||key==='destinationFee'?row.toCurrency as Currency??currency(row):currency(row));
    if(typeof value==='number'&&flags.has(key))return value?'Yes':'No';
    if(typeof value==='string'){if(key==='value'&&row.field==='amount'){try{return money(parseMoney(value,currency(row)),currency(row));}catch{return value;}}return references.has(key)||key==='value'&&references.has(String(row.field??row.type))?names.get(value)??'Related record':value;}
    if(Array.isArray(value))return value.map(item=>display(item,key,row)).join(', ')||'None';
    if(typeof value==='object')return Object.entries(value).filter(([field])=>!ignored.has(field)).map(([field,item])=>title(field)+': '+display(item,field,{...row,...value})).join(' · ');
    return String(value);
  };
  return changes.map(change=>({collection:change.collection,id:change.id,name:change.name===change.id?(names.get(String(change.after.categoryId??change.after.securityId??change.after.goalId??change.after.recurringEntryId??change.after.accountId))??title(change.collection)):change.name,existing:!!change.before,fields:Object.entries(change.after).filter(([key,value])=>!ignored.has(key)&&(!change.before||JSON.stringify(change.before[key])!==JSON.stringify(value))).map(([key,value])=>({label:title(key),before:change.before?display(change.before[key],key,change.before):null,after:display(value,key,change.after)}))}));
}
