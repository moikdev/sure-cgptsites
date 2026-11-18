import {accountBalance,BUDGET_EXCLUDED_KINDS,reportingTransactions,today,transferKind,validDate,type Currency,type FinanceState,type Transaction} from './finance.ts';
import {transferReportingEffects,type TransferReportingEffect} from './transfer-report-effects.ts';
export const TRANSFER_REPORTING_KINDS=['funds_movement','cc_payment','loan_payment','investment_contribution'] as const;
export interface TransferRepairEffect extends Omit<TransferReportingEffect,'type'>{type:'month'|'budget'|'goal';}
export interface InvestmentTransferRepairOptions {destinationAccountId?:string;}
function monthlyFigures(state:FinanceState,keys:Set<string>,asOf:string){
 const accounts=new Map(state.accounts.map(a=>[a.id,a])),totals=new Map([...keys].map(key=>[key,{income:0n,expenses:0n}]));
 for(const t of reportingTransactions(state)){const a=accounts.get(t.accountId);if(!a||a.excludedFromReports||t.excluded||t.date>asOf||BUDGET_EXCLUDED_KINDS.includes(t.kind))continue;const result=totals.get(JSON.stringify([a.currency,t.date.slice(0,7)]));if(!result)continue;if(t.amount>0)result.income+=BigInt(t.amount);else result.expenses+=BigInt(-t.amount);}
 return totals;
}
const safe=(value:bigint)=>{const n=Number(value);if(!Number.isSafeInteger(n))throw new Error('The reporting review exceeds the supported integer range.');return n;};
export function planInvestmentTransferRepair(state:FinanceState,options:InvestmentTransferRepairOptions={},asOf=today()){
 if(!validDate(asOf))throw new Error('Choose a valid investment transfer review date.');
 const accounts=new Map(state.accounts.map(a=>[a.id,a]));if(options.destinationAccountId&&!['investment','crypto'].includes(accounts.get(options.destinationAccountId)?.type??''))throw new Error('Choose an investment or crypto destination account.');
 const groups=new Map<string,Transaction[]>();for(const t of state.transactions)if(t.transferId){const rows=groups.get(t.transferId)??[];rows.push(t);groups.set(t.transferId,rows);}
 const next=structuredClone(state),nextTransactions=new Map(next.transactions.map(t=>[t.id,t])),details=new Map(state.transferDetails.map(d=>[d.id,d])),categories=new Map(state.categories.map(c=>[c.id,c.name])),transitions=new Map<string,number>(),related=new Set<string>(),skipped={chosenKind:0,excluded:0,protectedKind:0,alreadyCorrect:0};
 const changes:{transactionId:string;transferId:string;leg:'incoming'|'outgoing';transferStatus:'pending'|'confirmed';accountId:string;accountName:string;date:string;name:string;currency:Currency;amount:number;beforeKind:Transaction['kind'];afterKind:Transaction['kind'];category:string|null;archived:boolean;accountExcluded:boolean}[]=[];let checked=0;
 for(const [id,legs] of [...groups].sort(([a],[b])=>a.localeCompare(b))){
  const out=legs.find(t=>t.amount<0),into=legs.find(t=>t.amount>0),to=into&&accounts.get(into.accountId);if(!to||!['investment','crypto'].includes(to.type)||options.destinationAccountId&&to.id!==options.destinationAccountId)continue;
  const from=out&&accounts.get(out.accountId);if(legs.length!==2||!out||!into||!from)throw new Error('Repair needs two opposite entries with their original accounts.');checked++;
  for(const t of [into,out]){
   if(!TRANSFER_REPORTING_KINDS.some(kind=>kind===t.kind)){skipped.chosenKind++;continue;}
   if(t.excluded){skipped.excluded++;continue;}
   if(t.lockedFields?.includes('kind')){skipped.protectedKind++;continue;}
   const expected=t.id===into.id?'funds_movement':transferKind(from.type,to.type);if(t.kind===expected){skipped.alreadyCorrect++;continue;}
   nextTransactions.get(t.id)!.kind=expected;const transition=`${t.kind}->${expected}`;transitions.set(transition,(transitions.get(transition)??0)+1);related.add(from.id);related.add(to.id);const account=accounts.get(t.accountId)!;
   changes.push({transactionId:t.id,transferId:id,leg:t.id===into.id?'incoming':'outgoing',transferStatus:details.get(id)?.status==='pending'?'pending':'confirmed',accountId:t.accountId,accountName:account.name,date:t.date,name:t.name,currency:account.currency,amount:t.amount,beforeKind:t.kind,afterKind:expected,category:categories.get(t.categoryId??'')??null,archived:!!account.archived,accountExcluded:!!account.excludedFromReports});
  }
 }
 const effects:TransferRepairEffect[]=[],keys=new Set(changes.map(c=>JSON.stringify([c.currency,c.date.slice(0,7)]))),before=monthlyFigures(state,keys,asOf),after=monthlyFigures(next,keys,asOf);
 for(const key of [...keys].sort()){const [currency,month]=JSON.parse(key) as [Currency,string],a=before.get(key)!,b=after.get(key)!;if(a.income!==b.income||a.expenses!==b.expenses)effects.push({id:key,type:'month',name:month,currency,figures:[{label:'Reported income',before:safe(a.income),after:safe(b.income)},{label:'Reported expenses',before:safe(a.expenses),after:safe(b.expenses)}],notices:['Native reporting through '+asOf+'. Saved amounts and dates remain unchanged.']});}
 if(changes.length)effects.push(...transferReportingEffects(state,next,changes,[...related],asOf));
 const balances=state.accounts.filter(a=>related.has(a.id)).map(a=>({id:a.id,name:a.name,currency:a.currency,before:accountBalance(a,state,asOf),after:accountBalance(a,next,asOf)})),earliest=new Map<string,string>();for(const c of changes)if(!earliest.has(c.accountId)||earliest.get(c.accountId)!>c.date)earliest.set(c.accountId,c.date);
 const closedStatements=state.accountStatements.filter(s=>s.completedAt&&earliest.has(s.accountId)&&s.periodEnd>=earliest.get(s.accountId)!).map(s=>({id:s.id,title:s.title}));
 return {next,changes,review:{destinationAccountId:options.destinationAccountId??null,reviewedOn:asOf,checked,changed:changes.length,skipped,transitions:[...transitions].sort(([a],[b])=>a.localeCompare(b)).map(([transition,count])=>({transition,count})),changes,effects,totalEffects:effects.length,balances,closedStatements}};
}
export function investmentTransferRepairPage(review:ReturnType<typeof planInvestmentTransferRepair>['review'],offset=0,effectOffset=0){
 for(const [value,total,max] of [[offset,review.changed,20000],[effectOffset,review.totalEffects,40000]])if(!Number.isSafeInteger(value)||value<0||value%25||value>max||value!==0&&value>=total)throw new Error('Choose an available repair review page.');
 return {...review,changes:review.changes.slice(offset,offset+25),effects:review.effects.slice(effectOffset,effectOffset+25),offset,effectOffset};
}
export type InvestmentTransferRepairReview=ReturnType<typeof investmentTransferRepairPage>&{expectedRevision:number;receipt:string};
