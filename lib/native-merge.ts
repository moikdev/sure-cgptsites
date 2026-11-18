import {z} from 'zod';
import {csvDigest} from './csv-digest.ts';
import {accountBalance,type FinanceState} from './finance.ts';
import {remapWorkspace,validateWorkspace,workspaceState,type WorkspaceData} from './workspace.ts';
import {reflowBudgetHierarchy} from './budget-mutations.ts';
import {transferReportingEffects} from './transfer-report-effects.ts';

export const nativeAccountTargetsSchema=z.array(z.object({sourceId:z.string().min(1).max(160),targetId:z.string().uuid().nullable()}).strict()).max(500).refine(rows=>new Set(rows.map(r=>r.sourceId)).size===rows.length,'Choose each source account once.');
export type NativeAccountTargets=z.infer<typeof nativeAccountTargetsSchema>;
type Collection=Exclude<keyof WorkspaceData,'profile'>;
type Row={id:string;[field:string]:unknown};
export interface NativeMergeChange {collection:Collection;id:string;name:string;before:Row|null;after:Row;}
const rows=(data:WorkspaceData,key:Collection)=>data[key] as unknown as Row[];
const setRows=(data:WorkspaceData,key:Collection,value:Row[])=>{(data as unknown as Record<string,unknown>)[key]=value;};
const familyType=(type:string)=>['checking','savings'].includes(type)?'depository':type;
const fields=(row:Row,keys:string[])=>JSON.stringify(keys.map(key=>row[key]??null));
const content=(row:Row)=>JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='ownerId').sort(([a],[b])=>a.localeCompare(b))));
async function identity(seed:string,key:string){const h=await csvDigest(JSON.stringify(['native-merge-v1',seed,key]));return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
function rewrite<T>(value:T,ids:Map<string,string>):T{
  if(typeof value==='string')return (ids.get(value)??value) as T;
  if(Array.isArray(value))return value.map(item=>rewrite(item,ids)) as T;
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,rewrite(item,ids)])) as T;
  return value;
}

/** Reuse the complete recovery remapper, then stabilize its fresh identities.
 * Only freshly generated record/event identities enter this map. Source free
 * text and embedded source JSON remain unchanged. */
async function stableRemap(source:WorkspaceData,seed:string){
  const value=remapWorkspace(source),ids=new Map<string,string>();
  for(const key of Object.keys(value) as (keyof WorkspaceData)[])if(key!=='profile')for(const [index,row] of rows(value,key).entries())ids.set(row.id,await identity(seed,JSON.stringify([key,index])));
  for(const [index,statement] of value.accountStatements.entries())for(const key of ['adjustmentBefore','adjustmentAfter'] as const){const snapshot=statement[key];if(snapshot&&!ids.has(snapshot.id))ids.set(snapshot.id,await identity(seed,JSON.stringify(['statement-adjustment',index,key])));}
  for(const [index,pledge] of value.goalPledges.entries())if(pledge.matchedEventId)ids.set(pledge.matchedEventId,await identity(seed,JSON.stringify(['pledge-event',index])));
  return rewrite(value,ids);
}

export async function planNativeMerge(current:FinanceState,source:WorkspaceData,input:NativeAccountTargets,seed:string,reviewedOn:string,merchantWebsiteSources?:Set<string>,tagColorSources?:Set<string>,entryValuationSources:ReadonlySet<string>=new Set()){
  if(!current.profile)throw new Error('Create your workspace first.');
  const targets=nativeAccountTargetsSchema.parse(input),targetBySource=new Map(targets.map(t=>[t.sourceId,t.targetId]));
  if(targets.length!==source.accounts.length||source.accounts.some(a=>!targetBySource.has(a.id)))throw new Error('Choose an existing target or a new account for every source account, without unused choices.');
  const before=validateWorkspace({...current,budgets:[]}),next=structuredClone(before),keys=Object.keys(next).filter(k=>k!=='profile') as Collection[];
  let incoming=await stableRemap(source,seed);const existingIds=new Set(keys.flatMap(key=>rows(before,key).map(row=>row.id)));for(const key of keys)if(rows(incoming,key).some(row=>existingIds.has(row.id)))throw new Error('A proposed native import identifier already exists. Start a new request.');const ids=new Map<string,string>(),websitePresence=new Map<string,boolean>();
  for(const [index,account] of incoming.accounts.entries()){
    const original=source.accounts[index],targetId=targetBySource.get(original.id)!;
    if(targetId){const target=before.accounts.find(a=>a.id===targetId);if(!target||target.archived)throw new Error('Choose active manual accounts from your own workspace.');if(target.currency!==account.currency||familyType(target.type)!==familyType(account.type))throw new Error(`Account “${account.name}” needs a target with the same currency and account family.`);ids.set(account.id,target.id);}
  }
  for(const key of ['categories','tags','merchants','securities'] as const){
    const lookup=new Map<string,Row>();const keyFor=(row:Row)=>key==='securities'?fields(row,['ticker','exchange']):String(row.name);
    for(const row of [...rows(before,key)].sort((a,b)=>a.id.localeCompare(b.id)))if(!lookup.has(keyFor(row)))lookup.set(keyFor(row),row);
    for(const [index,row] of rows(incoming,key).entries()){const match=lookup.get(keyFor(row));if(match){if(key==='securities'&&match.kind!==row.kind)throw new Error('A matching ticker/exchange has a different cash-security classification. Resolve that security definition before importing.');ids.set(row.id,match.id);}else lookup.set(keyFor(row),row);if(key==='merchants')websitePresence.set(ids.get(row.id)??row.id,merchantWebsiteSources?.has(source.merchants[index].id)??true);}
  }
  incoming=rewrite(incoming,ids);
  for(const book of incoming.budgetBooks)if(book.legacyCompat&&before.budgetBooks.some(old=>old.legacyCompat&&old.currency===book.currency)){book.legacyCompat=0;if(before.budgetBooks.some(old=>old.name===book.name))book.name=('Imported · '+book.name).slice(0,160);}

  // A matched account keeps its existing accountable type, opening anchor,
  // exclusions and loan choices, as the source opening manager only creates a
  // fresh opening balance for newly created accounts.
  for(const account of incoming.accounts){const index=next.accounts.findIndex(a=>a.id===account.id);if(index<0)next.accounts.push(account);else {const updated={...next.accounts[index],name:account.name,archived:account.archived};if(account.assetDetails)updated.assetDetails=account.assetDetails;else delete updated.assetDetails;if(account.creditCardTerms)updated.creditCardTerms=account.creditCardTerms;else delete updated.creditCardTerms;if(account.subtype!=null)updated.subtype=account.subtype;else delete updated.subtype;if(account.cryptoTaxTreatment!=null)updated.cryptoTaxTreatment=account.cryptoTaxTreatment;else delete updated.cryptoTaxTreatment;if(account.archived&&account.archivedOn)updated.archivedOn=account.archivedOn;else delete updated.archivedOn;next.accounts[index]=updated;}}
  const categories=new Map(next.categories.map(c=>[c.id,c]));
  const saveCategory=(category:WorkspaceData['categories'][number],parentId:string|null,color:string,icon:string)=>{
    const parent=parentId?categories.get(parentId):null;
    if(parentId&&!parent)throw new Error('An imported parent category is missing.');
    if(parentId===category.id||parent&&(parent.parentId||next.categories.some(c=>c.parentId===category.id)))throw new Error('Imported category updates cannot create cycles or more than two hierarchy levels.');
    const previous=category.color;category.parentId=parentId;category.color=parent?.color??color;category.lucideIcon=icon;
    if(previous!==category.color)for(const child of next.categories)if(child.parentId===category.id)child.color=category.color;
  };
  for(const row of incoming.categories){let category=categories.get(row.id);if(!category){category={...row,parentId:null};categories.set(row.id,category);next.categories.push(category);}saveCategory(category,category.parentId,row.color,row.lucideIcon??'shapes');}
  for(const row of incoming.categories)if(row.parentId){const category=categories.get(row.id)!;saveCategory(category,row.parentId,category.color,category.lucideIcon??'shapes');}
  for(const key of ['tags','merchants','securities'] as const)for(const [sourceIndex,row] of rows(incoming,key).entries()){
    const list=rows(next,key),index=list.findIndex(old=>old.id===row.id);
    if(key==='tags'&&tagColorSources&&!tagColorSources.has(source.tags[sourceIndex].id))row.color=index<0?'#e99537':list[index].color;
    if(index<0)list.push(row);
    else if(key==='merchants')list[index]={...row,websiteUrl:websitePresence.get(row.id)?row.websiteUrl:list[index].websiteUrl};
    else if(key!=='securities')list[index]=row;
  }
  // These native observations are upserts at their source-defined natural key.
  // Keep an existing observation's identity and remap incoming references to it.
  const natural:{key:Collection;fields:string[]}[]=[
    {key:'exchangeRates',fields:['fromCurrency','toCurrency','date']},
    {key:'securityPrices',fields:['securityId','date','currency']},
    {key:'securitySplits',fields:['securityId','date']},
    {key:'valuations',fields:['accountId','date']},
    {key:'investmentCashBalances',fields:['accountId','date']},
    {key:'holdingSnapshots',fields:['accountId','securityId','date']},
    {key:'contributionBalances',fields:['accountId','date']},
  ];
  const observationIds=new Map<string,string>();
  for(const {key,fields:identityFields} of natural){const lookup=new Map(rows(before,key).map(row=>[fields(row,identityFields),row.id]));for(const row of rows(incoming,key)){const identity=fields(row,identityFields),id=lookup.get(identity);if(id)observationIds.set(row.id,id);else lookup.set(identity,row.id);}}
  incoming=rewrite(incoming,observationIds);
  const handled=new Set<Collection>(['accounts','categories','tags','merchants','securities']);
  for(const key of keys)if(!handled.has(key)&&key!=='budgets')for(const row of rows(incoming,key)){const list=rows(next,key),index=list.findIndex(old=>old.id===row.id);if(index<0)list.push(row);else list[index]=row;}
  const oldRuleIds=new Set(before.rules.map(r=>r.id)),lastPosition=Math.max(0,...before.rules.map(r=>r.position));
  next.rules.filter(r=>!oldRuleIds.has(r.id)).sort((a,b)=>a.position-b.position).forEach((r,index)=>{r.position=lastPosition+index+1;});
  const oldTradeIds=new Set(before.trades.map(t=>t.id)),sequence=new Map<string,number>();for(const trade of before.trades)sequence.set(trade.accountId,Math.max(sequence.get(trade.accountId)??-1,trade.sequence));
  for(const trade of next.trades.filter(t=>!oldTradeIds.has(t.id)).sort((a,b)=>a.sequence-b.sequence)){const nextSequence=(sequence.get(trade.accountId)??-1)+1;trade.sequence=nextSequence;sequence.set(trade.accountId,nextSequence);}
  // Reflow existing budget plans only. Newly imported independent plans keep
  // their own source allocations rather than borrowing reserves from old ones.
  if(next.categories.some(c=>before.categories.some(old=>old.id===c.id&&old.parentId!==c.parentId))){
    const oldPeriods=new Set(before.budgetPeriods.map(p=>p.id)),oldEnvelopes=new Set(before.budgetEnvelopes.map(e=>e.id)),temp=workspaceState(next);
    temp.budgetPeriods=temp.budgetPeriods.filter(p=>oldPeriods.has(p.id));temp.budgetEnvelopes=temp.budgetEnvelopes.filter(e=>oldPeriods.has(e.periodId));
    reflowBudgetHierarchy(workspaceState(before),temp);
    for(const envelope of temp.budgetEnvelopes)if(!oldEnvelopes.has(envelope.id))envelope.id=await identity(seed,JSON.stringify(['derived-budget-envelope',envelope.periodId,envelope.categoryId]));
    next.budgetPeriods=next.budgetPeriods.map(p=>temp.budgetPeriods.find(row=>row.id===p.id)??p);next.budgetEnvelopes=next.budgetEnvelopes.filter(e=>!oldPeriods.has(e.periodId)).concat(temp.budgetEnvelopes);
  }
  const newPeriodIds=new Set(incoming.budgetPeriods.map(p=>p.id));
  if(newPeriodIds.size&&incoming.categories.some(c=>next.categories.find(row=>row.id===c.id)?.parentId!==c.parentId)){
    const temp=workspaceState(next),sourceState=workspaceState(incoming),incomingEnvelopeIds=new Set(incoming.budgetEnvelopes.map(e=>e.id));
    temp.budgetPeriods=temp.budgetPeriods.filter(p=>newPeriodIds.has(p.id));temp.budgetEnvelopes=temp.budgetEnvelopes.filter(e=>newPeriodIds.has(e.periodId));
    reflowBudgetHierarchy(sourceState,temp);
    for(const envelope of temp.budgetEnvelopes)if(!incomingEnvelopeIds.has(envelope.id))envelope.id=await identity(seed,JSON.stringify(['derived-budget-envelope',envelope.periodId,envelope.categoryId]));
    next.budgetPeriods=next.budgetPeriods.map(p=>temp.budgetPeriods.find(row=>row.id===p.id)??p);next.budgetEnvelopes=next.budgetEnvelopes.filter(e=>!newPeriodIds.has(e.periodId)).concat(temp.budgetEnvelopes);
  }
  const changedDates=new Map<string,string>();
  for(const key of ['securityPrices','securitySplits'] as const){const old=new Map(rows(before,key).map(row=>[row.id,row]));for(const row of rows(next,key))if(!old.has(row.id)||content(old.get(row.id)!)!==content(row))for(const position of [...next.trades,...next.holdingSnapshots])if(position.securityId===row.securityId){const date=String(row.date);if(!changedDates.has(position.accountId)||changedDates.get(position.accountId)!>date)changedDates.set(position.accountId,date);}}

  for(const key of ['transactions','valuations','trades','holdingSnapshots','investmentCashBalances'] as const){const old=new Map(rows(before,key).map(row=>[row.id,row]));for(const row of rows(next,key))if(!old.has(row.id)||content(old.get(row.id)!)!==content(row)){const accountId=String(row.accountId),date=String(row.date);if(!changedDates.has(accountId)||changedDates.get(accountId)!>date)changedDates.set(accountId,date);}}
  for(const statement of next.accountStatements)if(statement.completedAt&&changedDates.has(statement.accountId)&&changedDates.get(statement.accountId)!<=statement.periodEnd)statement.reviewRequired=1;
  next.budgets=[];const combined=validateWorkspace(next),after=workspaceState(combined),changes:NativeMergeChange[]=[],created:Partial<Record<Collection,number>>={},updated:Partial<Record<Collection,number>>={};
  for(const key of keys){const old=new Map(rows(before,key).map(row=>[row.id,row]));for(const row of rows(combined,key)){const previous=old.get(row.id);if(!previous||content(previous)!==content(row)){changes.push({collection:key,id:row.id,name:String(row.name??row.ticker??row.date??row.id),before:previous??null,after:row});const counts=previous?updated:created;counts[key]=(counts[key]??0)+1;}}for(const id of old.keys())if(!rows(combined,key).some(row=>row.id===id))throw new Error('A native merge cannot remove existing financial records.');}
  const delta=structuredClone(combined);for(const key of keys){const old=new Set(rows(before,key).map(r=>r.id));setRows(delta,key,rows(combined,key).filter(row=>!old.has(row.id)));}
  const accounts=combined.accounts.map(account=>{const old=before.accounts.find(a=>a.id===account.id),prior=current.accounts.find(a=>a.id===account.id);return {id:account.id,name:account.name,previousName:old?.name??null,currency:account.currency,before:prior?accountBalance(prior,current,reviewedOn):null,after:accountBalance(after.accounts.find(a=>a.id===account.id)!,after,reviewedOn),created:!old,openingDate:account.openingDate,openingBalance:account.openingBalance};});
  const valuationEntries=new Map(incoming.valuations.map((v,i)=>[v.id,entryValuationSources.has(source.valuations[i].id)]));
  const ownership={accounts:delta.accounts.map(a=>a.id),transactions:delta.transactions.map(t=>t.id),trades:delta.trades.map(t=>t.id),valuations:delta.valuations.filter(v=>valuationEntries.get(v.id)).map(v=>v.id)};
  return {data:combined,delta,ownership,created,updated,changes,accounts,accountChoices:source.accounts.map((account,index)=>({sourceId:account.id,sourceName:account.name,targetId:incoming.accounts[index].id,targetName:combined.accounts.find(a=>a.id===incoming.accounts[index].id)!.name,previousName:before.accounts.find(a=>a.id===incoming.accounts[index].id)?.name??null,created:!targetBySource.get(account.id),currency:account.currency})),reportEffects:transferReportingEffects(current,after,[...changedDates].map(([accountId,date])=>({accountId,date})),combined.accounts.map(a=>a.id),reviewedOn)};
}
