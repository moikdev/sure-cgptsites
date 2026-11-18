import type {FinanceState} from './finance.ts';
import {transferReportingEffects} from './transfer-report-effects.ts';
import {budgetReports} from './budget.ts';
/** Include envelope movements even when aggregate period totals stay equal. */
export function ledgerReportingEffects(state:FinanceState,next:FinanceState,affected:{accountId:string;date:string}[],asOf:string){
 const effects=affected.length?transferReportingEffects(state,next,affected,[...new Set(affected.map(c=>c.accountId))],asOf):[],names=new Map(state.categories.map(c=>[c.id,c.name]));
 if(effects.length>20000)throw Error('This review exceeds 20,000 reporting effects. Narrow the selection.');
 for(const book of affected.length?state.budgetBooks:[]){const relevant=affected.filter(c=>book.accountMode==='all'||book.accountIds.includes(c.accountId)),first=relevant.map(c=>c.date).sort()[0];if(!first||!state.budgetPeriods.some(p=>p.bookId===book.id&&p.endDate>=first))continue;const before=budgetReports(state,book,asOf),after=budgetReports(next,book,asOf);
  for(const [periodId,a] of before){const b=after.get(periodId)!;for(const [categoryId,row] of a.rows){const updated=b.rows.get(categoryId)!;const figures=[{label:'Category spending',before:row.spendingComplete?row.spent:null,after:updated.spendingComplete?updated.spent:null},{label:'Incoming category rollover',before:row.carryComplete?row.carry:null,after:updated.carryComplete?updated.carry:null},{label:'Category available',before:row.available,after:updated.available},{label:'Shared category available',before:row.sharedAvailable,after:updated.sharedAvailable}];if(!figures.some(f=>f.before!==f.after))continue;if(effects.length>=20000)throw Error('This review exceeds 20,000 reporting effects. Narrow the selection.');effects.push({id:periodId+':'+categoryId,type:'budget',name:`${book.name} · ${a.period.startDate} to ${a.period.endDate} · ${names.get(categoryId)??'Uncategorized'}`,currency:a.period.currency,figures,notices:[...(!row.spendingComplete||!updated.spendingComplete?['Some category spending has incomplete conversion history.']:[]),...(!row.carryComplete||!updated.carryComplete?['Some category rollover history is incomplete.']:[])]});}}
 }
 return effects;
}
