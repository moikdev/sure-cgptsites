import {z} from 'zod';
import {parseCSV,toCSV} from './csv.ts';
import {csvDigest} from './csv-digest.ts';
import {categoryIconSchema} from './category-schema.ts';
import {reflowBudgetHierarchy} from './budget-mutations.ts';
import {transferReportingEffects} from './transfer-report-effects.ts';
import {validateWorkspace} from './workspace.ts';
import {today,type Category,type FinanceState} from './finance.ts';

export const CATEGORY_CSV_BYTES=10*1024*1024;
export const categoryDelimiter=z.enum([',',';','\t','|']);
export interface CategoryCSVRow {row:number;name:string;color:string;parent:string;icon:string;category:Category;resolvedParent:string|null;}
export interface CategoryCSVChange {before:Category|null;after:Category;parentBefore:string|null;parentAfter:string|null;}
const normalizeHeader=(value:string)=>value.trim().toLowerCase().replaceAll('*','').replace(/[\s-]+/g,'_');
const categoryValue=(c:Category)=>JSON.stringify([c.name,c.color,c.parentId??null,c.lucideIcon??null]);
export async function categoryCSVId(seed:string,kind:string,key:string){const h=await csvDigest(JSON.stringify(['category-csv-v1',seed,kind,key]));return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}

export async function planCategoryCSV(csv:string,delimiter:z.infer<typeof categoryDelimiter>,state:FinanceState,seed:string,asOf=today()){
  if(!state.profile)throw new Error('Create your workspace first.');
  const [header,...values]=parseCSV(csv,delimiter);
  if(!header?.length||header.length>100)throw new Error('Choose a category CSV with 1–100 headers.');
  const headers=header.map(normalizeHeader);
  if(new Set(headers).size!==headers.length)throw new Error('Category CSV headers must be unique after normalization.');
  const nameIndex=headers.indexOf('name'),colorIndex=headers.indexOf('color'),parentIndex=headers.indexOf('parent_category'),iconIndex=['lucide_icon','icon'].map(key=>headers.indexOf(key)).find(i=>i>=0)??-1;
  if(nameIndex<0)throw new Error('Category CSV needs a name column.');
  if(!values.length||values.length>10000)throw new Error('Import between 1 and 10,000 category rows.');
  const rows=values.map((v,i)=>{
    if(v.length!==header.length)throw new Error(`Row ${i+2}: column count does not match the header.`);
    const name=v[nameIndex].trim(),parent=v[parentIndex]?.trim()??'',color=v[colorIndex]?.trim()??'',icon=v[iconIndex]?.trim()??'';
    if(!name||name.length>80||parent.length>80||name==='__uncategorized__'||parent==='__uncategorized__')throw new Error(`Row ${i+2}: use nonblank category names up to 80 characters, excluding the reserved uncategorized label.`);
    if(color&&!/^#[a-fA-F0-9]{6}$/.test(color))throw new Error(`Row ${i+2}: category colors must use # followed by six hexadecimal digits.`);
    if(icon&&!categoryIconSchema.safeParse(icon).success)throw new Error(`Row ${i+2}: use an icon code of at most 80 characters.`);
    return {row:i+2,name,color,parent,icon};
  });
  const next=structuredClone(state);next.budgets=[];
  const byName=new Map(next.categories.map(c=>[c.name,c])),byId=new Map(next.categories.map(c=>[c.id,c]));
  const ensure=async(name:string)=>{
    let category=byName.get(name);if(category)return category;
    category={id:await categoryCSVId(seed,'category',name),ownerId:state.profile!.ownerId,name,color:'#737373',parentId:null,lucideIcon:'shapes'};
    if(byId.has(category.id))throw new Error('A proposed category identifier already exists. Restage this source.');
    byName.set(name,category);byId.set(category.id,category);next.categories.push(category);return category;
  };
  const save=(category:Category,parent:Category|null,color:string,icon:string)=>{
    if(parent?.id===category.id)throw new Error(`Category “${category.name}” cannot be its own parent.`);
    if(parent&&(parent.parentId||next.categories.some(c=>c.parentId===category.id)))throw new Error(`Category “${category.name}” cannot create more than two category levels. Make its parent a root and move its children first.`);
    const previous=category.color;
    category.parentId=parent?.id??null;category.color=parent?.color??color;category.lucideIcon=icon;
    if(previous!==category.color)for(const child of next.categories)if(child.parentId===category.id)child.color=category.color;
  };
  // Sure first detaches every named row and creates parent placeholders, then
  // assigns parents in source order. Repeated rows intentionally keep that order.
  for(const row of rows){const c=await ensure(row.name);save(c,null,row.color||c.color||'#737373',row.icon||c.lucideIcon||'shapes');if(row.parent)await ensure(row.parent);}
  for(const row of rows){const c=byName.get(row.name)!,parent=row.parent?byName.get(row.parent)!:null;if((c.parentId??null)!==(parent?.id??null))save(c,parent,c.color,c.lucideIcon??'shapes');}
  if(next.categories.length>2000)throw new Error('This import would exceed 2,000 categories in your workspace.');
  const before=new Map(state.categories.map(c=>[c.id,c])),changes:CategoryCSVChange[]=next.categories.filter(c=>!before.has(c.id)||categoryValue(before.get(c.id)!)!==categoryValue(c)).map(c=>({before:before.get(c.id)??null,after:c,parentBefore:state.categories.find(p=>p.id===before.get(c.id)?.parentId)?.name??null,parentAfter:byId.get(c.parentId??'')?.name??null}));
  const hierarchyChanged=changes.some(c=>(c.before?.parentId??null)!==(c.after.parentId??null));
  if(hierarchyChanged){
    reflowBudgetHierarchy(state,next);
    const oldEnvelopeIds=new Set(state.budgetEnvelopes.map(e=>e.id));
    for(const e of next.budgetEnvelopes)if(!oldEnvelopeIds.has(e.id))e.id=await categoryCSVId(seed,'envelope',JSON.stringify([e.periodId,e.categoryId]));
  }
  validateWorkspace(next);
  const budgetChanges=[
    ...next.budgetEnvelopes.flatMap(after=>{const before=state.budgetEnvelopes.find(e=>e.id===after.id)??null;return !before||JSON.stringify(before)!==JSON.stringify(after)?[{kind:'envelope' as const,id:after.id,name:byId.get(after.categoryId)!.name,periodId:after.periodId,periodLabel:next.budgetPeriods.find(p=>p.id===after.periodId)!.startDate+' to '+next.budgetPeriods.find(p=>p.id===after.periodId)!.endDate,currency:next.budgetPeriods.find(p=>p.id===after.periodId)!.currency,before:before?.allocated??0,after:after.allocated}]:[];}),
    ...next.budgetPeriods.flatMap(after=>{const before=state.budgetPeriods.find(p=>p.id===after.id)!;return before.budgetedSpending!==after.budgetedSpending?[{kind:'period' as const,id:after.id,name:next.budgetBooks.find(b=>b.id===after.bookId)!.name+' · '+after.startDate,periodId:after.id,periodLabel:after.startDate+' to '+after.endDate,currency:after.currency,before:before.budgetedSpending,after:after.budgetedSpending}]:[];}),
  ];
  const reportEffects=hierarchyChanged?transferReportingEffects(state,next,state.transactions.map(t=>({accountId:t.accountId,date:t.date})),state.accounts.map(a=>a.id),asOf):[];
  return {state:next,rows:rows.map(row=>({...row,category:byName.get(row.name)!,resolvedParent:byId.get(byName.get(row.name)!.parentId??'')?.name??null})),changes,budgetChanges,reportEffects,total:rows.length,created:changes.filter(c=>!c.before).length,updated:changes.filter(c=>c.before).length};
}

export function categoriesCSV(categories:readonly Category[]){
  const byId=new Map(categories.map(c=>[c.id,c]));
  return toCSV([['name','color','parent_category','lucide_icon'],...[...categories].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)).map(c=>[c.name,c.color,byId.get(c.parentId??'')?.name??'',c.lucideIcon??''])]);
}
