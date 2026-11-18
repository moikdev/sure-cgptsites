import {budgetTree} from './budget.ts';
import {sumMinorUnits,type FinanceState} from './finance.ts';
import type {BudgetEnvelope,BudgetPeriod} from './budget-types.ts';
export function periodEnvelopes(state:FinanceState,id:string){return state.budgetEnvelopes.filter(e=>e.periodId===id);}
export function ensureEnvelope(state:FinanceState,period:BudgetPeriod,categoryId:string){let row=state.budgetEnvelopes.find(e=>e.periodId===period.id&&e.categoryId===categoryId);if(!row){row={id:crypto.randomUUID(),ownerId:period.ownerId,periodId:period.id,categoryId,allocated:0,rolloverEnabled:0,importedCarry:null};state.budgetEnvelopes.push(row);}return row;}
export function refreshAutomaticBudgetTotals(state:FinanceState){const {roots}=budgetTree(state);for(const p of state.budgetPeriods)if(p.autoTotal){const amounts=new Map(periodEnvelopes(state,p.id).map(e=>[e.categoryId,e.allocated]));p.budgetedSpending=sumMinorUnits(roots.map(id=>amounts.get(id)??0));}}
export function setBudgetAllocation(state:FinanceState,period:BudgetPeriod,categoryId:string,allocated:number){
 const {categories,children}=budgetTree(state),rows=new Map(periodEnvelopes(state,period.id).map(e=>[e.categoryId,e])),old=new Map([...rows].map(([id,e])=>[id,e.allocated]));
 const frontier=(id:string,amount:(id:string)=>number):string[]=>(children.get(id)??[]).flatMap(child=>amount(child)>0?[child]:frontier(child,amount));
 const reserve=new Map<string,number>();let ancestor=categories.get(categoryId)?.parentId??null;
 while(ancestor){reserve.set(ancestor,Math.max(0,sumMinorUnits([old.get(ancestor)??0,...frontier(ancestor,id=>old.get(id)??0).map(id=>-(old.get(id)??0))])));ancestor=categories.get(ancestor)?.parentId??null;}
 const row=ensureEnvelope(state,period,categoryId);row.allocated=allocated;rows.set(categoryId,row);ancestor=categories.get(categoryId)?.parentId??null;
 while(ancestor){const parent=ensureEnvelope(state,period,ancestor);rows.set(ancestor,parent);parent.allocated=sumMinorUnits([reserve.get(ancestor)??0,...frontier(ancestor,id=>rows.get(id)?.allocated??0).map(id=>rows.get(id)?.allocated??0)]);ancestor=categories.get(ancestor)?.parentId??null;}
 refreshAutomaticBudgetTotals(state);
}
export function reflowBudgetHierarchy(before:FinanceState,after:FinanceState){
 const oldTree=budgetTree(before),nextTree=budgetTree(after),valid=new Set(after.categories.map(c=>c.id));after.budgetEnvelopes=after.budgetEnvelopes.filter(e=>valid.has(e.categoryId));
 for(const period of after.budgetPeriods){const old=new Map(periodEnvelopes(before,period.id).map(e=>[e.categoryId,e.allocated])),frontier=(id:string):string[]=>(oldTree.children.get(id)??[]).flatMap(child=>(old.get(child)??0)>0?[child]:frontier(child)),reserve=new Map(before.categories.map(c=>[c.id,Math.max(0,sumMinorUnits([old.get(c.id)??0,...frontier(c.id).map(id=>-(old.get(id)??0))]))])),memo=new Map<string,number>();
  const total=(id:string):number=>{if(memo.has(id))return memo.get(id)!;const amount=sumMinorUnits([reserve.get(id)??0,...(nextTree.children.get(id)??[]).map(total)]);memo.set(id,amount);return amount;};
  for(const category of after.categories){const amount=total(category.id),existing=after.budgetEnvelopes.find(e=>e.periodId===period.id&&e.categoryId===category.id);if(existing)existing.allocated=amount;else if(amount)ensureEnvelope(after,period,category.id).allocated=amount;}
 }
 refreshAutomaticBudgetTotals(after);
}
export function budgetAllocationMovable(state:FinanceState,periodId:string,categoryId:string){const {children}=budgetTree(state),amounts=new Map(periodEnvelopes(state,periodId).map(e=>[e.categoryId,e.allocated]));const frontier=(id:string):string[]=>(children.get(id)??[]).flatMap(child=>(amounts.get(child)??0)>0?[child]:frontier(child));return Math.max(0,sumMinorUnits([amounts.get(categoryId)??0,...frontier(categoryId).map(id=>-(amounts.get(id)??0))]));}
