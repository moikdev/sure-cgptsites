import {budgetReports,budgetTree} from './budget.ts';
import {sumMinorUnits,type FinanceState} from './finance.ts';
export function validateBudgetWorkspace(state:FinanceState){
 const unique=(rows:{id:string}[],name:string)=>{if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error(`Duplicate ${name} identifiers.`);};unique(state.budgetBooks,'budget plan');unique(state.budgetPeriods,'budget period');unique(state.budgetEnvelopes,'budget envelope');
 const books=new Map(state.budgetBooks.map(b=>[b.id,b])),periods=new Map(state.budgetPeriods.map(p=>[p.id,p])),categories=new Set(state.categories.map(c=>c.id)),accounts=new Set(state.accounts.map(a=>a.id)),seen=new Set<string>();const guard=(key:string)=>{if(seen.has(key))throw new Error('Duplicate budget period, envelope or primary currency plan.');seen.add(key);};
 for(const b of state.budgetBooks){if(b.accountIds.some(id=>!accounts.has(id)))throw new Error('A budget plan references a missing account.');if(b.legacyCompat)guard('primary:'+b.currency);}
 for(const p of state.budgetPeriods){if(!books.has(p.bookId))throw new Error('A budget period references a missing plan.');if(p.endDate<p.startDate)throw new Error('A budget end date precedes its start date.');guard(JSON.stringify(['period',p.bookId,p.startDate,p.endDate]));}
 for(const e of state.budgetEnvelopes){if(!periods.has(e.periodId)||!categories.has(e.categoryId))throw new Error('A budget envelope references a missing period or category.');guard(JSON.stringify(['envelope',e.periodId,e.categoryId]));}
 const {roots}=budgetTree(state);for(const p of state.budgetPeriods)if(p.autoTotal){const amounts=new Map(state.budgetEnvelopes.filter(e=>e.periodId===p.id).map(e=>[e.categoryId,e.allocated]));if(p.budgetedSpending!==sumMinorUnits(roots.map(id=>amounts.get(id)??0)))throw new Error('An automatic budget total does not match its category allocations.');}
 for(const book of state.budgetBooks)budgetReports(state,book,undefined,{retain:false,nativeOnly:true,strict:true});
}
