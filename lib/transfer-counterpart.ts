import {accountBalance,today,validDate,type FinanceState,type Transaction} from './finance.ts';
import {planTransferMatch,transferMatchCandidates,transferMatchIssue} from './transfer-match.ts';

export interface TransferCounterpartOptions {transactionId:string;targetAccountId:string;requestId:string;counterpartAmount?:number;counterpartDate?:string;counterpartName?:string;counterpartNotes?:string;}
export function normalizeTransferCounterpart(state:FinanceState,options:TransferCounterpartOptions){
  const original=state.transactions.find(t=>t.id===options.transactionId),target=state.accounts.find(a=>a.id===options.targetAccountId);
  if(!original)throw new Error('Transaction not found.');if(!target)throw new Error('Target account not found.');
  const account=state.accounts.find(a=>a.id===original.accountId);if(!account)throw new Error('Original account not found.');
  if(account.id===target.id)throw new Error('Choose a different account for the missing entry.');
  const date=options.counterpartDate??original.date,amount=options.counterpartAmount??(account.currency===target.currency?Math.abs(original.amount):null);
  if(!validDate(date)||Math.abs(Date.parse(date)-Date.parse(original.date))>30*86400000)throw new Error('The missing entry must be dated within 30 days of the original.');
  if(date<target.openingDate)throw new Error(`The missing entry must be on or after ${target.openingDate}, the target account’s opening date.`);
  if(amount===null)throw new Error(`Enter the actual missing-entry amount in ${target.currency}.`);
  if(!Number.isSafeInteger(amount)||amount<=0||amount>1_000_000_000_000)throw new Error('Enter a positive, supported native account amount.');
  if(account.currency===target.currency&&amount!==Math.abs(original.amount))throw new Error('Same-currency transfer amounts must be equal and opposite. Record actual fees separately.');
  const destination=original.amount>0?account:target,name=(options.counterpartName??`Transfer to ${destination.name}`.slice(0,160)).trim(),notes=(options.counterpartNotes??'').trim();
  if(!name||name.length>160||notes.length>2000)throw new Error('Use a description up to 160 characters and notes up to 2,000 characters.');
  const normalized={transactionId:original.id,targetAccountId:target.id,requestId:options.requestId,counterpartAmount:amount,counterpartDate:date,counterpartName:name,counterpartNotes:notes};
  return {original,account,target,normalized};
}
export function planTransferCounterpart(state:FinanceState,options:TransferCounterpartOptions,asOf=today(),newTransactionId='review-created-entry',newTransferId='review-created-transfer'){
  const {original,target,normalized}=normalizeTransferCounterpart(state,options),issue=transferMatchIssue(state,original);if(issue)throw new Error(issue);
  if(original.transferId)throw new Error('The original entry is already part of a transfer.');
  if(target.archived)throw new Error('Restore the target account before creating its missing entry.');
  if(state.transactions.some(t=>t.id===newTransactionId))throw new Error('The counterpart identity is already in use.');
  const created:Transaction={id:newTransactionId,ownerId:original.ownerId,accountId:target.id,categoryId:null,date:normalized.counterpartDate,name:normalized.counterpartName,amount:Math.sign(original.amount)*-normalized.counterpartAmount,kind:'standard',transferId:null,notes:normalized.counterpartNotes,importKey:null,excluded:0,merchantId:null,tagIds:[],lockedFields:[],reconciledStatus:'unreconciled',reconciledAt:null,reconciledStatementId:null};
  const staged={...state,transactions:state.transactions.concat(created)},plan=planTransferMatch(staged,{operation:'link',transactionId:original.id,counterpartId:created.id},asOf,newTransferId);
  const eligible=new Set(transferMatchCandidates(state,original.id).map(c=>c.transactionId)),duplicates=state.transactions.filter(t=>t.accountId===target.id&&t.amount===created.amount&&Math.abs(Date.parse(t.date)-Date.parse(original.date))<=30*86400000).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).map(t=>({id:t.id,name:t.name,date:t.date,amount:t.amount,currency:target.currency,alreadyLinked:!!t.transferId,canLink:eligible.has(t.id)}));
  const newRow=plan.next.transactions.find(t=>t.id===created.id)!;
  return {...plan,created:newRow,normalized,review:{...plan.review,operation:'create' as const,requestId:options.requestId,transactionId:original.id,counterpartId:'new-entry',targetAccountId:target.id,counterpartAmount:normalized.counterpartAmount,counterpartDate:normalized.counterpartDate,counterpartName:normalized.counterpartName,counterpartNotes:normalized.counterpartNotes,legs:plan.review.legs.map(t=>({...t,id:t.id===created.id?'new-entry':t.id,created:t.id===created.id})),accounts:plan.review.accounts.map(a=>({...a,before:accountBalance(state.accounts.find(account=>account.id===a.accountId)!,state,asOf)})),duplicates,duplicateTotal:duplicates.length}};
}
export function transferCounterpartPage(report:ReturnType<typeof planTransferCounterpart>['review'],offset=0){if(!Number.isSafeInteger(offset)||offset<0||offset%25||offset>20000||offset!==0&&offset>=report.duplicateTotal)throw new Error('Choose an available page of possible counterparts.');return {...report,duplicates:report.duplicates.slice(offset,offset+25),offset};}
export type TransferCounterpartReview=ReturnType<typeof transferCounterpartPage>&{expectedRevision:number;receipt:string};
