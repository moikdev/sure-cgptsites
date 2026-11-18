import {budgetReports,budgetTree,type BudgetReport,type BudgetCategoryReport} from './budget.ts';
import {budgetQuote} from './budget-fx.ts';
import {periodEnvelopes} from './budget-mutations.ts';
import {convertAtRate,findRate} from './fx.ts';
import {sumMinorUnits,today,validDate,type FinanceState} from './finance.ts';
import {csvDigest} from './csv-digest.ts';
import {validateWorkspace} from './workspace.ts';

export interface BudgetCopyOptions {sourceId:string;targetId:string;date:string;}
export async function planBudgetCopy(state:FinanceState,options:BudgetCopyOptions,reviewedOn=today()){
 const source=state.budgetPeriods.find(p=>p.id===options.sourceId),target=state.budgetPeriods.find(p=>p.id===options.targetId);
 if(!source||!target)throw new Error('Budget period not found.');
 if(!validDate(options.date)||options.date>reviewedOn)throw new Error('Choose a valid conversion date through today.');
 if(source.bookId!==target.bookId||source.startDate>=target.startDate||source.budgetedSpending===null)throw new Error('Choose an earlier initialized period in the same budget plan.');
 if(target.budgetedSpending!==null)throw new Error('Only an uninitialized period can copy an earlier budget.');
 // Bound retained before/after report graphs within the Worker memory limit.
 if(state.budgetPeriods.filter(p=>p.bookId===target.bookId).length*Math.max(1,state.categories.length)>20000)throw new Error('This budget history exceeds 20,000 period/category combinations for a complete copy review. Set this period’s amounts directly.');
 const q=findRate(state,source.currency,target.currency,options.date);
 if(!q)throw new Error('Save a direct or inverse exchange rate on the conversion date or within its five prior days.');
 const next=structuredClone(state);next.budgets=[];
 const nextTarget=next.budgetPeriods.find(p=>p.id===target.id)!,oldRows=periodEnvelopes(state,target.id),sourceRows=periodEnvelopes(state,source.id),categories=new Map(state.categories.map(c=>[c.id,c]));
 const convert=(amount:number)=>convertAtRate(amount,source.currency,target.currency,q);
 const copied=await Promise.all(sourceRows.map(async e=>{const old=oldRows.find(r=>r.categoryId===e.categoryId),hash=await csvDigest(JSON.stringify(['budget-copy-v1',state.profile?.ownerId,state.profile?.revision,options,e.categoryId]));return {...e,id:old?.id??`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`,periodId:target.id,allocated:convert(e.allocated),importedCarry:null};}));
 next.budgetEnvelopes=next.budgetEnvelopes.filter(e=>e.periodId!==target.id).concat(copied);
 nextTarget.budgetedSpending=convert(source.budgetedSpending);nextTarget.expectedIncome=source.expectedIncome===null?null:convert(source.expectedIncome);nextTarget.autoTotal=source.autoTotal;
 const {roots}=budgetTree(next),rootIds=new Set(roots),allocated=sumMinorUnits(copied.filter(e=>rootIds.has(e.categoryId)).map(e=>e.allocated)),roundedSpending=nextTarget.budgetedSpending;
 if(nextTarget.autoTotal)nextTarget.budgetedSpending=allocated;
 validateWorkspace(next);
 const beforeReports=budgetReports(state,state.budgetBooks.find(b=>b.id===target.bookId)!,reviewedOn),afterReports=budgetReports(next,next.budgetBooks.find(b=>b.id===target.bookId)!,reviewedOn);
 const rows=[...new Set([...sourceRows.map(e=>e.categoryId),...oldRows.map(e=>e.categoryId)])].sort((a,b)=>(categories.get(a)?.name??'').localeCompare(categories.get(b)?.name??'')||a.localeCompare(b)).map(id=>{const original=sourceRows.find(e=>e.categoryId===id),before=oldRows.find(e=>e.categoryId===id),after=copied.find(e=>e.categoryId===id),report=afterReports.get(target.id)!.rows.get(id);return {categoryId:id,name:categories.get(id)?.name??id,sourceAmount:original?.allocated??null,beforeAmount:before?.allocated??null,afterAmount:after?.allocated??null,rolloverEnabled:!!after?.rolloverEnabled,clearedCarry:before?.importedCarry??null,overAllocated:report?.overAllocated??0,shared:report?.inherits??false};});
 const summary=(r:BudgetReport)=>({planned:r.period.budgetedSpending,expectedIncome:r.period.expectedIncome,allocated:r.allocated,unallocated:r.unallocated,carry:r.totalCarry,knownCarry:r.knownCarry,available:r.available,actualSpending:r.actualSpending,complete:r.actualsComplete&&r.carryComplete&&r.billsComplete&&r.incomeComplete&&!r.rangeErrors.length,rangeErrors:r.rangeErrors});
 const effects=next.budgetPeriods.filter(p=>p.bookId===target.bookId&&p.startDate>=target.startDate).sort((a,b)=>a.startDate.localeCompare(b.startDate)||a.endDate.localeCompare(b.endDate)||a.id.localeCompare(b.id)).flatMap(p=>{
  const before=beforeReports.get(p.id)!,after=afterReports.get(p.id)!,base={startDate:p.startDate,endDate:p.endDate,currency:p.currency,before:summary(before),after:summary(after)};
  const summaryChanged=p.id===target.id||JSON.stringify(base.before)!==JSON.stringify(base.after);
  const entries:(typeof base&{id:string;kind:'period'|'category';categoryName:string|null;categoryBefore:BudgetCategoryReport|null;categoryAfter:BudgetCategoryReport|null})[]=summaryChanged?[{...base,id:p.id,kind:'period',categoryName:null,categoryBefore:null,categoryAfter:null}]:[];
  for(const [id,row] of after.rows){const old=before.rows.get(id)!;if(JSON.stringify(old)!==JSON.stringify(row))entries.push({...base,id:p.id+':'+id,kind:'category' as const,categoryName:categories.get(id)?.name??id,categoryBefore:old,categoryAfter:row});}
  return entries;
 });
 if(effects.length>40000)throw new Error('This copy affects more than 40,000 period and category review rows. Set this period’s amounts directly or reduce the budget history first.');
 const warnings=['Each inclusive envelope is converted and rounded independently to the target currency’s minor unit. Parent totals and child totals can differ after rounding.','Allocation copying changes your spending plan; account balances and ledger entries are unchanged. Imported carry amounts are cleared and rollover is recalculated from history.'];
 if(source.currency!==target.currency)warnings.push('Carry does not cross a change of currency. Later periods in the target currency can receive recalculated carry.');
 if(rows.some(r=>r.overAllocated))warnings.push('Funded descendants exceed a parent allocation. Review the displayed excess and adjust allocations after copying.');
 if(effects.some(e=>!e.after.complete))warnings.push('Some period figures remain incomplete because recorded rates or history are missing, or a calculation exceeds the supported range.');
 if(roundedSpending!==nextTarget.budgetedSpending)warnings.push('Automatic planned spending uses the sum of converted root allocations instead of rounding the source total separately.');
 return {next,source,target,after:nextTarget,date:options.date,reviewedOn,quote:budgetQuote(source.currency,target.currency,options.date,q),roundedSpending,allocated,rows,effects,warnings};
}
export function budgetCopyPage(plan:Awaited<ReturnType<typeof planBudgetCopy>>,offset=0,effectOffset=0){const {next,rows,effects,...rest}=plan;void next;return {...rest,rows:rows.slice(offset,offset+25),total:rows.length,offset,effects:effects.slice(effectOffset,effectOffset+25),effectTotal:effects.length,effectOffset};}
