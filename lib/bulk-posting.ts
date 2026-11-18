import {accountBalance,type Account,type FinanceState,type SplitLine,type Transaction} from './finance.ts';
import type {ReconciledStatus} from './reconciliation-types.ts';

type PostingPatch = {date?:string;reconciledStatus?:ReconciledStatus};

export function postingChanges(state:FinanceState,root:Transaction,line:SplitLine|undefined,account:Account,patch:PostingPatch,reviewedAt:string){
 const date=line ? root.date : patch.date ?? root.date;
 const moved=date!==root.date;
 const previous=line?.reconciliation?.status ?? root.reconciledStatus ?? 'unreconciled';
 if(moved){
  if(date<account.openingDate)throw Error('Choose a date on or after the opening of '+account.name+'.');
  if(state.recurringAllocations.some(row=>row.transactionId===root.id))throw Error('Remove the bill-payment link before moving '+root.name+'.');
  if(state.goalConsumptions.some(row=>row.transactionId===root.id))throw Error('Remove the linked goal usage before moving '+root.name+'.');
 }
 const status=patch.reconciledStatus ?? (moved?'unreconciled':previous);
 if(patch.reconciledStatus&&status!=='unreconciled'&&date>reviewedAt.slice(0,10))throw Error('Future entries can be marked cleared or reconciled after their posting date.');
 // A deliberately checked legacy child becomes independent even if its current displayed value matches.
 const independent=!!(line&&patch.reconciledStatus&&!line.reconciliation);
 const statusChanged=status!==previous||independent;
 const previousAt=line?.reconciliation ? line.reconciliation.at : root.reconciledAt??null;
 const at=status==='reconciled'?(!moved&&previous==='reconciled'&&previousAt?previousAt:reviewedAt):null;
 const rootFields:Partial<Transaction>=moved||statusChanged ? {date,reconciledStatus:status,reconciledAt:at,reconciledStatementId:!moved&&status==='reconciled'?root.reconciledStatementId??null:null} : {};
 const lineFields:Partial<SplitLine>=statusChanged?{reconciliation:{status,at}}:{};
 return {moved,statusChanged,date,previous,status,rootFields,lineFields};
}

export function postingConsequences(state:FinanceState,next:FinanceState,changed:Transaction[],asOf:string){
 const oldRoots=new Map(state.transactions.map(t=>[t.id,t])),newRoots=new Map(next.transactions.map(t=>[t.id,t]));
 const changedIds=new Set(changed.map(t=>t.id));
 const earliest=new Map<string,string>(),statementIds=new Set<string>();
 const details=new Map(state.transferDetails.map(d=>[d.id,d]));
 for(const row of changed){
  const old=oldRoots.get(row.id)!;
  if(old.reconciledStatementId&&old.reconciledStatementId!==row.reconciledStatementId)statementIds.add(old.reconciledStatementId);
  if(row.date===old.date)continue;
  const first=[row.date,old.date,earliest.get(row.accountId)??row.date].sort()[0];
  earliest.set(row.accountId,first);
  const detail=row.transferId?details.get(row.transferId):undefined;
  if(detail)details.set(detail.id,{...detail,[row.amount<0?'date':'destinationDate']:row.date});
 }
 const transferChanges=state.transferDetails.filter(d=>details.get(d.id)!==d).map(d=>details.get(d.id)!);
 next.transferDetails=state.transferDetails.map(d=>details.get(d.id)!);
 if(earliest.size){
  const legs=new Map(next.transactions.filter(t=>t.transferId).map(t=>[JSON.stringify([t.transferId,t.amount<0?'source':'destination']),t]));
  for(const fee of state.transferFees){
   const leg=legs.get(JSON.stringify([fee.transferId,fee.side])),expense=newRoots.get(fee.transactionId);
   if(leg&&expense&&(changedIds.has(leg.id)||changedIds.has(expense.id))&&leg.date!==expense.date)throw Error('Select both the transfer posting “'+leg.name+'” and its fee “'+expense.name+'” to move their date together.');
  }
 }
 const statements=state.accountStatements.filter(s=>s.completedAt&&(statementIds.has(s.id)||earliest.has(s.accountId)&&s.periodEnd>=earliest.get(s.accountId)!));
 const affected=new Set(statements.map(s=>s.id));
 next.accountStatements=state.accountStatements.map(s=>affected.has(s.id)?{...s,reviewRequired:1}:s);
 const balances=state.accounts.filter(a=>earliest.has(a.id)).map(a=>({id:a.id,name:a.name,currency:a.currency,asOf,before:accountBalance(a,state,asOf),after:accountBalance(a,next,asOf)}));
 const movedIds=new Set(changed.filter(t=>oldRoots.get(t.id)!.date!==t.date).map(t=>t.id));
 const evidence=[
  ...state.goalPledges.filter(p=>p.matchedTransactionId&&movedIds.has(p.matchedTransactionId)).map(p=>({kind:'Savings match',id:p.id,date:p.matchedDate,entry:newRoots.get(p.matchedTransactionId!)!.name})),
  ...state.recurringPriceChanges.filter(p=>p.transactionId&&movedIds.has(p.transactionId)).map(p=>({kind:'Bill price observation',id:p.id,date:p.effectiveOn,entry:newRoots.get(p.transactionId!)!.name}))
 ];
 return {transferChanges,statements,balances,evidence};
}
