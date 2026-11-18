import {manualAssetDetailsStatements} from './manual-asset-persistence';
import {cardTermsStatements} from './credit-card-persistence';
import {accountDetailsStatements} from './account-details-persistence';
import {database} from './repository';
import {workspaceInsertStatements} from './migration-repository';
import {investmentCollections,investmentColumns,investmentValues,type InvestmentCollection} from './investment-persistence';
import {budgetCollections,budgetColumns,budgetValues,type BudgetCollection} from './budget-persistence';
import {fxColumns,fxValues} from './fx-persistence';
import {contributionColumns,contributionValues} from './contribution-persistence';
import {statementSqlColumns,statementValues} from './reconciliation-persistence';
import {fileColumns,fileFields} from './statement-file-persistence';
import type {planNativeMerge,NativeMergeChange} from './native-merge';
type Row={id:string;[key:string]:unknown};
type Config={table:string;columns:readonly string[];values:(row:Row)=>(string|number|null)[]};
const flat=(fields:string[],json:string[]=[])=>(row:Row)=>fields.map(key=>json.includes(key)?row[key]==null?null:JSON.stringify(row[key]):row[key]??null) as (string|number|null)[];
const configs:Record<string,Config>={
  accounts:{table:'accounts',columns:['id','owner_id','name','type','currency','opening_balance','opening_date','archived','excluded_from_reports','loan_terms','cash_planning_excluded','loan_replay'],values:flat(['id','ownerId','name','type','currency','openingBalance','openingDate','archived','excludedFromReports','loanTerms','cashPlanningExcluded','loanReplay'],['loanTerms'])},
  categories:{table:'categories',columns:['id','owner_id','name','color','parent_id','lucide_icon'],values:flat(['id','ownerId','name','color','parentId','lucideIcon'])},
  tags:{table:'tags',columns:['id','owner_id','name','color'],values:flat(['id','ownerId','name','color'])},
  merchants:{table:'merchants',columns:['id','owner_id','name','color','website_url'],values:flat(['id','ownerId','name','color','websiteUrl'])},
  valuations:{table:'valuations',columns:['id','owner_id','account_id','date','amount','name','kind'],values:flat(['id','ownerId','accountId','date','amount','name','kind'])},
  exchangeRates:{table:'exchange_rates',columns:fxColumns('exchangeRates'),values:row=>fxValues('exchangeRates',row)},
  contributionBalances:{table:'contribution_balances',columns:contributionColumns,values:contributionValues},
  accountStatements:{table:'account_statements',columns:statementSqlColumns,values:statementValues},
};
for(const key of Object.keys(investmentCollections) as InvestmentCollection[])configs[key]={table:investmentCollections[key].table,columns:investmentColumns(key),values:row=>investmentValues(key,row)};
for(const key of Object.keys(budgetCollections) as BudgetCollection[])configs[key]={table:budgetCollections[key].table,columns:budgetColumns(key),values:row=>budgetValues(key,row)};
function update(owner:string,change:NativeMergeChange){
  const config=configs[change.collection];if(!config)throw new Error('Unsupported native merge update.');
  const before=config.values({...change.before!,ownerId:owner}),after=config.values({...change.after,ownerId:owner}),indices=config.columns.flatMap((key,index)=>key!=='id'&&key!=='owner_id'&&before[index]!==after[index]?[index]:[]);
  const archive=change.collection==='accounts'&&(change.before?.archivedOn??null)!==(change.after.archivedOn??null)?[change.after.archivedOn?database().prepare('INSERT INTO account_archive_dates(owner_id,account_id,archived_on) VALUES(?,?,?) ON CONFLICT(owner_id,account_id) DO UPDATE SET archived_on=excluded.archived_on').bind(owner,change.id,String(change.after.archivedOn)):database().prepare('DELETE FROM account_archive_dates WHERE owner_id=? AND account_id=?').bind(owner,change.id)]:[];
  const details=change.collection==='accounts'&&((change.before?.subtype??null)!==(change.after.subtype??null)||(change.before?.cryptoTaxTreatment??null)!==(change.after.cryptoTaxTreatment??null))?accountDetailsStatements(owner,change.id,change.after.subtype as string|undefined,change.after.cryptoTaxTreatment as import('./account-details').CryptoTaxTreatment|undefined):[];
  const card=change.collection==='accounts'&&JSON.stringify(change.before?.creditCardTerms??null)!==JSON.stringify(change.after.creditCardTerms??null)?cardTermsStatements(owner,change.id,change.after.creditCardTerms as import('./credit-card-types').CreditCardTerms|null):[];
  const asset=change.collection==='accounts'&&JSON.stringify(change.before?.assetDetails??null)!==JSON.stringify(change.after.assetDetails??null)?manualAssetDetailsStatements(owner,change.id,change.after.assetDetails as import('./manual-asset-schema').ManualAssetDetails|null):[];
  if(!indices.length)return [...archive,...details,...card,...asset];
  return [database().prepare(`UPDATE ${config.table} SET ${indices.map(i=>config.columns[i]+'=?').join(',')} WHERE owner_id=? AND id=?`).bind(...indices.map(i=>after[i]),owner,change.id),...archive,...details,...card,...asset];
}
export function nativeMergeStatements(owner:string,plan:Pick<Awaited<ReturnType<typeof planNativeMerge>>,'delta'|'changes'>){
  const db=database();return [
    ...workspaceInsertStatements(owner,plan.delta),
    ...plan.changes.filter(change=>change.before).flatMap(change=>update(owner,change)),
    ...plan.delta.statementFiles.map(file=>db.prepare(`INSERT INTO statement_files(${fileColumns.join(',')}) VALUES(${fileColumns.map(()=>'?').join(',')})`).bind(...fileFields.map(field=>field==='ownerId'?owner:file[field as keyof typeof file]))),
    ...plan.delta.transactionReceipts.map(r=>db.prepare('INSERT INTO transaction_receipts(id,owner_id,transaction_id,file_id,created_at) VALUES(?,?,?,?,?)').bind(r.id,owner,r.transactionId,r.fileId,r.createdAt)),
  ];
}
