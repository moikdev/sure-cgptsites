import {csvDigest} from './csv-digest.ts';
import type {CSVEntityResolver} from './csv.ts';
import {transferReportingEffects} from './transfer-report-effects.ts';
import {mappedCSVAccountRows,type CSVAccountMappings} from './csv-account-mapping.ts';
import {accountBalance,today} from './finance.ts';
import {importRows,type ImportRow} from './csv.ts';import type {CSVImportOptions} from './csv-schema.ts';
import type {FinanceState,Transaction} from './finance.ts';import {evaluateRules} from './rules.ts';
export const MAX_STAGED_CSV_BYTES=10*1024*1024,MAX_STAGED_CSV_ROWS=10000;
export {csvDigest} from './csv-digest.ts';
export async function planStagedCSV(state:FinanceState,accountId:string,csv:string,options:CSVImportOptions,accountMappings?:CSVAccountMappings,identitySeed?:string,reviewedOn=today(),resolveEntities?:CSVEntityResolver,reportBefore:FinanceState=state){
 const account=state.accounts.find(a=>a.id===accountId);if(!accountMappings&&(!account||account.archived))throw new Error('Restore or select the original account before importing.');
 const rows=accountMappings?mappedCSVAccountRows(csv,state.accounts,options,accountMappings,resolveEntities):importRows(csv,account!.currency,account!.name,options,MAX_STAGED_CSV_ROWS,undefined,resolveEntities),occurrences=new Map<string,number>(),existing=new Set(state.transactions.filter(t=>t.importKey).map(t=>JSON.stringify([t.accountId,t.importKey]))),newRows:Transaction[]=[],existingChanges:{row:number;before:Transaction;after:Transaction;accountName:string;currency:FinanceState['accounts'][number]['currency']}[]=[],review:{row:number;transaction:ImportRow;duplicate:boolean;accountId:string;accountName:string;currency:FinanceState['accounts'][number]['currency']}[]=[];const accountMap=new Map(state.accounts.map(a=>[a.id,a]));
 const makeLookup=(list:{id:string;name:string}[],label:string)=>{const exact=new Map<string,string[]>(),lower=new Map<string,string[]>();for(const r of list){exact.set(r.name,[...(exact.get(r.name)??[]),r.id]);lower.set(r.name.toLowerCase(),[...(lower.get(r.name.toLowerCase())??[]),r.id]);}return (name:string)=>{if(!name)return null;const matches=exact.get(name)??lower.get(name.toLowerCase())??[];if(matches.length!==1)throw new Error(`${matches.length?'Ambiguous':'Unknown'} ${label} “${name}”. Create a distinct matching name first or leave the column empty.`);return matches[0];};},category=makeLookup(state.categories,'category'),merchant=makeLookup(state.merchants,'merchant'),tag=makeLookup(state.tags,'tag'),existingByKey=new Map(state.transactions.filter(t=>t.importKey).map(t=>[JSON.stringify([t.accountId,t.importKey]),t]));
 for(const [index,row] of rows.entries()){
  const target=accountMap.get(row.accountId??accountId)!;
  if(row.date<target.openingDate)throw new Error(`Row ${index+2}: date is before this account’s opening date (${target.openingDate}).`);
  const categoryId=category(row.category),merchantId=merchant(row.merchant),tagIds=row.tags.map(name=>tag(name)!);
  // Ordinals belong to the target account; aliases share that account’s sequence.
  const canonical=JSON.stringify([row.date,row.name,row.amount,row.notes,row.kind]),occurrenceKey=JSON.stringify([target.id,canonical]),occurrence=occurrences.get(occurrenceKey)??0;occurrences.set(occurrenceKey,occurrence+1);
  const importKey=await csvDigest(`${canonical}:${occurrence}`),duplicate=existing.has(JSON.stringify([target.id,importKey]));review.push({row:index+2,transaction:row,duplicate,accountId:target.id,accountName:target.name,currency:target.currency});
  if(duplicate&&resolveEntities){const before=existingByKey.get(JSON.stringify([target.id,importKey]))!;if(before){const after={...before,...(categoryId?{categoryId}:{}),...(tagIds.length?{tagIds}:{}),...(row.notes?{notes:row.notes}:{})};if(before.categoryId!==after.categoryId||JSON.stringify(before.tagIds??[])!==JSON.stringify(after.tagIds??[])||before.notes!==after.notes)existingChanges.push({row:index+2,before,after,accountName:target.name,currency:target.currency});}}
  // Stable IDs keep same-day loan replay ordering identical in review and commit.
  // The seed includes the last reversal so re-imports receive fresh identities.
  if(!duplicate){existing.add(JSON.stringify([target.id,importKey]));let id=crypto.randomUUID();if(identitySeed){const h=await csvDigest(JSON.stringify([identitySeed,target.id,importKey]));id=`${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}newRows.push({id,ownerId:state.profile!.ownerId,accountId:target.id,categoryId,merchantId,tagIds,date:row.date,name:row.name,amount:row.amount,kind:row.kind,notes:row.notes,excluded:+row.excluded,importKey,transferId:null,lockedFields:[],investmentActivity:row.investmentActivity,reconciledStatus:row.reconciledStatus,reconciledAt:row.reconciledStatus==='reconciled'?new Date().toISOString():null,reconciledStatementId:null});}
 }
 const updates=new Map(existingChanges.map(c=>[c.after.id,c.after])),pending={...state,transactions:state.transactions.map(t=>updates.get(t.id)??t).concat(newRows)},result=newRows.length?evaluateRules(pending,{scope:{transactionIds:newRows.map(t=>t.id)}}):null;
 const used=[...new Set(review.map(r=>r.accountId))],after=result?.state??pending,accounts=used.map(id=>{const a=accountMap.get(id)!,entries=review.filter(r=>r.accountId===id);return {id,name:a.name,currency:a.currency,rows:entries.length,imported:entries.filter(r=>!r.duplicate).length,skipped:entries.filter(r=>r.duplicate).length,before:accountBalance(a,state,reviewedOn),after:accountBalance(a,after,reviewedOn)};});
 const reportEffects=resolveEntities?transferReportingEffects(reportBefore,after,[...existingChanges.map(c=>c.after),...newRows],used,reviewedOn):[];
 return {existingChanges,reportEffects,account:account??accountMap.get(used[0])!,accounts,review,newRows,pending,result,total:rows.length,imported:newRows.length,skipped:rows.length-newRows.length};
}
