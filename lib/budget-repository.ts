import {invalidateRuleReference} from './rules';
import {ApiError,commitMutation,database,readState} from './repository';
import {budgetCommandSchema} from './budget-schema';
import {budgetCollections,budgetColumns,budgetValues,type BudgetCollection} from './budget-persistence';
import {budgetTree,budgetPeriodForMonth} from './budget';
import {budgetAllocationMovable,ensureEnvelope,periodEnvelopes,reflowBudgetHierarchy,refreshAutomaticBudgetTotals,setBudgetAllocation} from './budget-mutations';
import {validateWorkspace} from './workspace';
import {sumMinorUnits,type FinanceState} from './finance';
import type {BudgetBook,BudgetPeriod} from './budget-types';
export function budgetChangeStatements(owner:string,before:FinanceState,after:FinanceState){
 const db=database(),statements:D1PreparedStatement[]=[];
 for(const key of ['budgetEnvelopes','budgetPeriods','budgetBooks'] as BudgetCollection[])for(const row of before[key])if(!after[key].some(next=>next.id===row.id)){if(key==='budgetEnvelopes')statements.push(db.prepare('DELETE FROM budgets WHERE owner_id=? AND id=?').bind(owner,row.id));statements.push(db.prepare(`DELETE FROM ${budgetCollections[key].table} WHERE owner_id=? AND id=?`).bind(owner,row.id));}
 for(const key of ['budgetBooks','budgetPeriods','budgetEnvelopes'] as BudgetCollection[]){const meta=budgetCollections[key],columns=budgetColumns(key);for(const row of after[key]){const old=before[key].find(old=>old.id===row.id),values=budgetValues(key,row);if(old&&JSON.stringify(values)===JSON.stringify(budgetValues(key,old)))continue;statements.push(old?db.prepare(`UPDATE ${meta.table} SET ${columns.slice(2).map(c=>`${c}=?`).join(',')} WHERE owner_id=? AND id=?`).bind(...values.slice(2),owner,row.id):db.prepare(`INSERT INTO ${meta.table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...values));}}
 return statements;
}
export async function executeBudgetCommand(owner:string,input:unknown,revision:number):Promise<{message:string}|null>{
 const parsed=budgetCommandSchema.safeParse(input);if(!parsed.success)return null;const c=parsed.data,state=await readState(owner),next=structuredClone(state),db=database(),statements:D1PreparedStatement[]=[];next.budgets=[];
 if(state.profile?.revision!==revision)throw new ApiError(409,'Your workspace changed. Reload and try again.');
 const book=(id:string)=>{const b=next.budgetBooks.find(b=>b.id===id);if(!b)throw new ApiError(404,'Budget plan not found.');return b;};
 const period=(id:string)=>{const p=next.budgetPeriods.find(p=>p.id===id);if(!p)throw new ApiError(404,'Budget period not found.');return p;};
 const category=(id:string)=>{const cat=next.categories.find(cat=>cat.id===id);if(!cat)throw new ApiError(404,'Category not found.');return cat;};
 const prior=(p:BudgetPeriod)=>next.budgetPeriods.filter(old=>old.bookId===p.bookId&&old.id!==p.id&&old.startDate<p.startDate&&old.budgetedSpending!==null).sort((a,b)=>b.startDate.localeCompare(a.startDate)||b.endDate.localeCompare(a.endDate))[0];
 const inherit=(p:BudgetPeriod)=>{const source=prior(p);if(source)for(const e of periodEnvelopes(next,source.id))if(e.rolloverEnabled)ensureEnvelope(next,p,e.categoryId).rolloverEnabled=1;};
 const legacyPeriod=(currency:BudgetPeriod['currency'],month:string)=>{
  const dates=budgetPeriodForMonth(month),matching=next.budgetPeriods.filter(p=>p.currency===currency&&p.startDate===dates.startDate&&p.endDate===dates.endDate&&next.budgetBooks.some(b=>b.id===p.bookId&&b.legacyCompat)).sort((a,b)=>Number(book(b.bookId).currency===currency)-Number(book(a.bookId).currency===currency)||a.id.localeCompare(b.id))[0];if(matching)return matching;
  let b=next.budgetBooks.find(b=>b.legacyCompat&&b.currency===currency);if(!b){b={id:crypto.randomUUID(),ownerId:owner,name:`${currency} budget`,currency,startDay:1,accountMode:'all',accountIds:[],sourceKind:'household',sourceReference:null,legacyCompat:1};next.budgetBooks.push(b);}
  let p=next.budgetPeriods.find(p=>p.bookId===b!.id&&p.startDate===dates.startDate&&p.endDate===dates.endDate);if(!p){p={id:crypto.randomUUID(),ownerId:owner,bookId:b.id,...dates,currency,budgetedSpending:0,expectedIncome:null,autoTotal:1};next.budgetPeriods.push(p);inherit(p);}if(p.currency!==currency)throw new ApiError(400,'This period uses another currency.');return p;
 };
 try{
 switch(c.action){
 case 'budgetBook':{
  if(c.id)book(c.id);for(const id of c.accountIds)if(!next.accounts.some(a=>a.id===id))throw new ApiError(404,'Budget account not found.');
  if(c.legacyCompat&&next.budgetBooks.some(b=>b.id!==c.id&&b.legacyCompat&&b.currency===c.currency))throw new ApiError(409,'A primary budget plan already exists for this currency.');
  const row:BudgetBook={...c,id:c.id??crypto.randomUUID(),ownerId:owner,accountIds:c.accountMode==='all'?[]:c.accountIds};const i=next.budgetBooks.findIndex(b=>b.id===row.id);if(i>=0)next.budgetBooks[i]=row;else{if(!next.budgetBooks.some(b=>b.legacyCompat&&b.currency===row.currency))row.legacyCompat=1;next.budgetBooks.push(row);}break;
 }
 case 'deleteBudgetBook':{book(c.id);const ids=new Set(next.budgetPeriods.filter(p=>p.bookId===c.id).map(p=>p.id));next.budgetEnvelopes=next.budgetEnvelopes.filter(e=>!ids.has(e.periodId));next.budgetPeriods=next.budgetPeriods.filter(p=>!ids.has(p.id));next.budgetBooks=next.budgetBooks.filter(b=>b.id!==c.id);break;}
 case 'budgetPeriod':{
  book(c.bookId);const old=c.id?period(c.id):null;if(old&&(old.bookId!==c.bookId||old.currency!==c.currency))throw new ApiError(400,'A period keeps its original budget plan and currency. Create a new period to use another currency.');
  if(c.endDate<c.startDate)throw new ApiError(400,'The end date must be on or after the start date.');if(next.budgetPeriods.some(p=>p.id!==c.id&&p.bookId===c.bookId&&p.startDate===c.startDate&&p.endDate===c.endDate))throw new ApiError(409,'This budget period already exists.');
  const row:BudgetPeriod={...c,id:c.id??crypto.randomUUID(),ownerId:owner};const i=next.budgetPeriods.findIndex(p=>p.id===row.id);if(i>=0)next.budgetPeriods[i]=row;else{next.budgetPeriods.push(row);inherit(row);}refreshAutomaticBudgetTotals(next);break;
 }
 case 'deleteBudgetPeriod':{period(c.id);next.budgetEnvelopes=next.budgetEnvelopes.filter(e=>e.periodId!==c.id);next.budgetPeriods=next.budgetPeriods.filter(p=>p.id!==c.id);break;}
 case 'budgetEnvelope':{
  const p=period(c.periodId);category(c.categoryId);const row=ensureEnvelope(next,p,c.categoryId);setBudgetAllocation(next,p,c.categoryId,c.allocated);if(c.importedCarry!==undefined)row.importedCarry=c.importedCarry;
  if(c.rolloverEnabled!==undefined){row.rolloverEnabled=c.rolloverEnabled?1:0;for(const later of next.budgetPeriods.filter(l=>l.bookId===p.bookId&&l.startDate>p.startDate)){const existing=next.budgetEnvelopes.find(e=>e.periodId===later.id&&e.categoryId===c.categoryId);if(c.rolloverEnabled||existing)ensureEnvelope(next,later,c.categoryId).rolloverEnabled=row.rolloverEnabled;}}
  break;
 }
 case 'moveBudgetAllocation':{
  const p=period(c.periodId);category(c.fromCategoryId);category(c.toCategoryId);if(c.fromCategoryId===c.toCategoryId)throw new ApiError(400,'Choose two different categories.');const {categories}=budgetTree(next);const related=(from:string,to:string)=>{let id=categories.get(from)?.parentId;while(id){if(id===to)return true;id=categories.get(id)?.parentId;}return false;};if(related(c.fromCategoryId,c.toCategoryId)||related(c.toCategoryId,c.fromCategoryId))throw new ApiError(400,'Move allocation between categories that are not ancestors of one another.');if(c.amount>budgetAllocationMovable(next,p.id,c.fromCategoryId))throw new ApiError(400,'The source does not have enough allocation outside its funded subcategories.');const from=ensureEnvelope(next,p,c.fromCategoryId),to=ensureEnvelope(next,p,c.toCategoryId);setBudgetAllocation(next,p,c.fromCategoryId,from.allocated-c.amount);setBudgetAllocation(next,p,c.toCategoryId,sumMinorUnits([to.allocated,c.amount]));break;
 }
 case 'copyBudgetPeriod':{
  const target=period(c.id);if(target.budgetedSpending!==null)throw new ApiError(409,'Only an uninitialized period can copy an earlier budget.');const source=c.sourceId?period(c.sourceId):prior(target);if(!source||source.bookId!==target.bookId||source.startDate>=target.startDate||source.budgetedSpending===null)throw new ApiError(400,'Choose an earlier initialized period in the same budget plan.');if(source.currency!==target.currency)throw new ApiError(400,'Copying allocations between currencies requires conversion. Set this period’s amounts directly.');target.budgetedSpending=source.budgetedSpending;target.expectedIncome=source.expectedIncome;target.autoTotal=source.autoTotal;const rows=periodEnvelopes(next,source.id).map(e=>({...e,id:crypto.randomUUID(),periodId:target.id,importedCarry:null}));next.budgetEnvelopes=next.budgetEnvelopes.filter(e=>e.periodId!==target.id).concat(rows);break;
 }
 case 'budget':{category(c.categoryId);const p=legacyPeriod(c.currency,c.month),{children}=budgetTree(next),amounts=new Map(periodEnvelopes(next,p.id).map(e=>[e.categoryId,e.allocated]));setBudgetAllocation(next,p,c.categoryId,sumMinorUnits([c.amount,...(children.get(c.categoryId)??[]).map(id=>amounts.get(id)??0)]));break;}
 case 'deleteBudget':{statements.push(db.prepare('DELETE FROM budgets WHERE owner_id=? AND id=?').bind(owner,c.id));const e=next.budgetEnvelopes.find(e=>e.id===c.id);if(!e)throw new ApiError(404,'Budget allocation not found.');const p=period(e.periodId),{children}=budgetTree(next),amounts=new Map(periodEnvelopes(next,p.id).map(e=>[e.categoryId,e.allocated]));setBudgetAllocation(next,p,e.categoryId,sumMinorUnits((children.get(e.categoryId)??[]).map(id=>amounts.get(id)??0)));break;}
 case 'category':{
  if(c.id)category(c.id);if(c.parentId)category(c.parentId);const id=c.id??crypto.randomUUID();if(next.categories.some(cat=>cat.id!==id&&cat.name.toLowerCase()===c.name.toLowerCase()))throw new ApiError(409,'A category with this name already exists.');const old=c.id?category(c.id):null,row={...(old?.lucideIcon?{lucideIcon:old.lucideIcon}:{}),...(c.lucideIcon===undefined?{}:{lucideIcon:c.lucideIcon}),id,ownerId:owner,name:c.name,color:c.color,parentId:c.parentId};next.categories=next.categories.filter(cat=>cat.id!==id).concat(row);let parent=c.parentId;const seen=new Set([id]);while(parent){if(seen.has(parent)||seen.size>=10)throw new ApiError(400,'Category parents cannot form a cycle or exceed ten levels.');seen.add(parent);parent=next.categories.find(cat=>cat.id===parent)?.parentId??null;}if(old&&old.parentId!==c.parentId)reflowBudgetHierarchy(state,next);
  statements.push(old?db.prepare('UPDATE categories SET name=?,color=?,parent_id=?,lucide_icon=COALESCE(?,lucide_icon) WHERE owner_id=? AND id=?').bind(c.name,c.color,c.parentId,c.lucideIcon??null,owner,id):db.prepare('INSERT INTO categories (id,owner_id,name,color,parent_id,lucide_icon) VALUES (?,?,?,?,?,?)').bind(id,owner,c.name,c.color,c.parentId,c.lucideIcon??null));break;
 }
 case 'deleteCategory':{
  category(c.id);invalidateRuleReference(next,'categoryId',c.id);next.categories=next.categories.filter(cat=>cat.id!==c.id).map(cat=>cat.parentId===c.id?{...cat,parentId:null}:cat);next.transactions=next.transactions.map(t=>t.categoryId===c.id?{...t,categoryId:null}:t);next.splitLines=next.splitLines.map(l=>l.categoryId===c.id?{...l,categoryId:null}:l);next.recurringEntries=next.recurringEntries.map(r=>r.categoryId===c.id?{...r,categoryId:null}:r);reflowBudgetHierarchy(state,next);
  statements.push(db.prepare('UPDATE split_lines SET category_id=NULL WHERE owner_id=? AND category_id=?').bind(owner,c.id),db.prepare('UPDATE recurring_entries SET category_id=NULL WHERE owner_id=? AND category_id=?').bind(owner,c.id),db.prepare('UPDATE transactions SET category_id=NULL WHERE owner_id=? AND category_id=?').bind(owner,c.id),db.prepare('UPDATE categories SET parent_id=NULL WHERE owner_id=? AND parent_id=?').bind(owner,c.id),db.prepare('DELETE FROM categories WHERE owner_id=? AND id=?').bind(owner,c.id));break;
 }
 }
 validateWorkspace(next);
 }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,(error as Error).message);}
 await commitMutation(owner,revision,[...statements,...budgetChangeStatements(owner,state,next)]);return {message:'Budget updated.'};
}
