import {accountBalance,today,transferKind,validDate,type FinanceState,type Transaction} from './finance.ts';
import {transferMatchIssue,transferPairWithinTolerance} from './transfer-match.ts';
import {transferPairKey} from './transfer-hints.ts';
import {impliedRate,rateText} from './fx.ts';
import type {TransferDetail} from './fx-types.ts';

export const isPendingTransfer=(state:Pick<FinanceState,'transferDetails'>,id:string|null|undefined)=>!!id&&state.transferDetails.some(d=>d.id===id&&d.status==='pending');
export interface AutoTransferOptions {operation:'scan'|'confirm'|'reject'|'release'|'settings';enabled?:boolean;transferIds?:string[];accountId?:string;}
export function automaticTransferCandidates(state:FinanceState,accountId?:string){
 if(state.profile?.autoTransferDisabled===1)return [];
 if(accountId&&!state.accounts.some(a=>a.id===accountId&&!a.archived))throw new Error('Choose an active account for matching.');
 const accounts=new Map(state.accounts.map(a=>[a.id,a])),rejected=new Set(state.transferMatchRejections.map(r=>transferPairKey(r.outflowTransactionId,r.inflowTransactionId))),routes=new Set<string>();
 const pendingIds=new Set(state.transferDetails.filter(d=>d.status==='pending').map(d=>d.id)),groups=new Map<string,Transaction[]>();for(const t of state.transactions)if(t.transferId&&!pendingIds.has(t.transferId)){const g=groups.get(t.transferId)??[];g.push(t);groups.set(t.transferId,g);}
 for(const g of groups.values()){const out=g.find(t=>t.amount<0),into=g.find(t=>t.amount>0);if(g.length===2&&out&&into)routes.add(JSON.stringify([out.accountId,into.accountId]));}
 const candidates:{outflowTransactionId:string;inflowTransactionId:string;matchRank:number;daysApart:number}[]=[],barred=new Set([...state.splitLines.map(l=>l.transactionId),...state.transferFees.map(f=>f.transactionId),...state.recurringAllocations.flatMap(a=>a.transactionId?[a.transactionId]:[]),...state.goalConsumptions.flatMap(c=>c.transactionId?[c.transactionId]:[])]),eligible=state.transactions.filter(t=>!t.transferId&&!t.splitParentId&&!t.excluded&&!barred.has(t.id)&&accounts.has(t.accountId)&&!accounts.get(t.accountId)!.archived),inflows=new Map<string,Transaction[]>();
 for(const t of eligible)if(t.amount>0){const list=inflows.get(t.date)??[];list.push(t);inflows.set(t.date,list);}
 let evaluated=0;
 for(const out of eligible){if(out.amount>=0)continue;
  for(let delta=-4;delta<=4;delta++){const date=new Date(Date.parse(out.date+'T00:00:00Z')+delta*86400000).toISOString().slice(0,10);
   for(const into of inflows.get(date)??[]){if(accountId&&out.accountId!==accountId&&into.accountId!==accountId)continue;if(++evaluated>1000000)throw new Error('This scan has too many possible pairs. Select one account to narrow it.');if(out.accountId===into.accountId||rejected.has(transferPairKey(out.id,into.id)))continue;
    const same=accounts.get(out.accountId)!.currency===accounts.get(into.accountId)!.currency;
    // All accounts here are manual. FX guesses need a confirmed route in the same direction.
    if(same?out.amount+into.amount!==0:!routes.has(JSON.stringify([out.accountId,into.accountId]))||!transferPairWithinTolerance(state,out,into,1000))continue;
    if(candidates.length>=100000)throw new Error('This scan has too many possible pairs. Select one account to narrow it.');
    candidates.push({outflowTransactionId:out.id,inflowTransactionId:into.id,matchRank:same?0:1,daysApart:Math.abs(delta)});
   }
  }
 }
 return candidates.sort((a,b)=>a.matchRank-b.matchRank||a.daysApart-b.daysApart||a.outflowTransactionId.localeCompare(b.outflowTransactionId)||a.inflowTransactionId.localeCompare(b.inflowTransactionId));
}
export function planAutomaticTransfers(state:FinanceState,options:AutoTransferOptions,asOf=today(),newId=(index:number)=>`review-pending-${index}`,newCategoryId='review-pending-category'){
 if(!validDate(asOf))throw new Error('Choose a valid transfer review date.');
 if(options.operation==='settings'?(typeof options.enabled!=='boolean'||options.accountId!==undefined||options.transferIds!==undefined):options.enabled!==undefined||options.operation==='scan'&&options.transferIds!==undefined||options.operation!=='scan'&&options.accountId!==undefined)throw new Error('Choose either matching settings, a scan scope or pending matches to resolve.');
 const enabledBefore=state.profile?.autoTransferDisabled!==1,enabledAfter=options.operation==='settings'?options.enabled!:enabledBefore,preferenceChanged=enabledBefore!==enabledAfter,writeOperation=options.operation==='settings'?(enabledAfter?'scan' as const:'release' as const):options.operation;
 if(options.operation==='settings'&&!state.profile)throw new Error('Create your workspace before changing matching settings.');
 const next=structuredClone(state),changes:{id:string;outflowTransactionId:string;inflowTransactionId:string;outflowKindBefore:Transaction['kind'];outflowKindAfter:Transaction['kind'];inflowKindBefore:Transaction['kind'];inflowKindAfter:Transaction['kind'];categoryBefore:string|null;categoryAfter:string|null;categoryCreated:boolean;from:{id:string;name:string;currency:FinanceState['accounts'][number]['currency'];date:string;amount:number};to:{id:string;name:string;currency:FinanceState['accounts'][number]['currency'];date:string;amount:number};rate:string}[]=[],rejections:FinanceState['transferMatchRejections']=[];
 const beforeById=new Map(state.transactions.map(t=>[t.id,t])),nextById=new Map(next.transactions.map(t=>[t.id,t])),accountsById=new Map(state.accounts.map(a=>[a.id,a])),beforeCategories=new Map(state.categories.map(c=>[c.id,c])),afterCategories=new Map(next.categories.map(c=>[c.id,c])),detailsById=new Map(next.transferDetails.map(d=>[d.id,d])),legsByTransfer=new Map<string,Transaction[]>(),removedTransfers=new Set<string>();
 for(const t of next.transactions)if(t.transferId){const legs=legsByTransfer.get(t.transferId)??[];legs.push(t);legsByTransfer.set(t.transferId,legs);}
 if(options.operation==='settings'&&preferenceChanged)next.profile!.autoTransferDisabled=enabledAfter?0:1;
 let categoryToCreate:FinanceState['categories'][number]|null=null;
 if(writeOperation==='scan'){
  const used=new Set<string>();for(const c of options.operation==='settings'&&!preferenceChanged?[]:automaticTransferCandidates(next,options.accountId)){if(used.has(c.outflowTransactionId)||used.has(c.inflowTransactionId))continue;
   const out=beforeById.get(c.outflowTransactionId)!,into=beforeById.get(c.inflowTransactionId)!,from=accountsById.get(out.accountId)!,to=accountsById.get(into.accountId)!,quote=impliedRate(-out.amount,from.currency,into.amount,to.currency);
   const detail:TransferDetail={id:newId(changes.length),ownerId:out.ownerId,status:'pending',date:out.date,destinationDate:into.date,fromCurrency:from.currency,toCurrency:to.currency,fromAmount:-out.amount,toAmount:into.amount,rateNumerator:String(quote.numerator),rateDenominator:String(quote.denominator),rateDate:from.currency===to.currency?null:out.date,rateSource:from.currency===to.currency?'identity':'manual',sourceFee:0,destinationFee:0,requestId:null,requestFingerprint:null};next.transferDetails.push(detail);
   // Pending links affect principal-only loan replay, but preserve every reporting kind/category.
   for(const id of [c.outflowTransactionId,c.inflowTransactionId])nextById.get(id)!.transferId=detail.id;
   used.add(c.outflowTransactionId);used.add(c.inflowTransactionId);append(detail.id,c.outflowTransactionId,c.inflowTransactionId);
  }
 }else{
  const ids=options.operation==='settings'?(preferenceChanged?state.transferDetails.filter(d=>d.status==='pending'&&legsByTransfer.get(d.id)?.length===2&&legsByTransfer.get(d.id)!.every(t=>t.kind==='standard')).map(d=>d.id):[]):options.transferIds;if(!ids||!ids.length&&options.operation!=='settings'||ids.length>10000||new Set(ids).size!==ids.length)throw new Error('Choose one or more distinct pending matches.');
  for(const id of ids){const detail=detailsById.get(id);if(!detail||detail.status!=='pending')throw new Error('A selected transfer is no longer pending. Reload the matches.');
   const legs=legsByTransfer.get(id)??[],out=legs.find(t=>t.amount<0),into=legs.find(t=>t.amount>0);if(legs.length!==2||!out||!into)throw new Error('This pending match needs two opposite entries.');
   if(writeOperation==='confirm'){
    for(const leg of legs){const issue=transferMatchIssue(next,leg);if(issue)throw new Error(issue);}
    const from=next.accounts.find(a=>a.id===out.accountId)!,to=next.accounts.find(a=>a.id===into.accountId)!;
    detail.status='confirmed';out.kind=transferKind(from.type,to.type);into.kind='funds_movement';
    if(out.kind==='investment_contribution'&&!out.categoryId){let category=next.categories.find(c=>c.name==='Investment Contributions');if(!category){category={id:newCategoryId,ownerId:out.ownerId,name:'Investment Contributions',color:'#0d9488',parentId:null};categoryToCreate=category;next.categories.push(category);afterCategories.set(category.id,category);}out.categoryId=category.id;}
   }else{
    // Source release_transactions deliberately retains all pre-existing kinds and protections for pending pairs.
    removedTransfers.add(id);for(const leg of legs)leg.transferId=null;
    if(writeOperation==='reject'&&!next.transferMatchRejections.some(r=>r.outflowTransactionId===out.id&&r.inflowTransactionId===into.id)){const r={id:newId(rejections.length),ownerId:out.ownerId,outflowTransactionId:out.id,inflowTransactionId:into.id,createdAt:null,updatedAt:null};rejections.push(r);next.transferMatchRejections.push(r);}
   }
   append(id,out.id,into.id);
  }
 }
 if(removedTransfers.size)next.transferDetails=next.transferDetails.filter(d=>!removedTransfers.has(d.id));
 function append(id:string,outId:string,inId:string){const out=nextById.get(outId)!,into=nextById.get(inId)!,before=beforeById.get(outId)!,incomingBefore=beforeById.get(inId)!,from=accountsById.get(out.accountId)!,to=accountsById.get(into.accountId)!,quote=impliedRate(-out.amount,from.currency,into.amount,to.currency);changes.push({id,outflowTransactionId:outId,inflowTransactionId:inId,outflowKindBefore:before.kind,outflowKindAfter:out.kind,inflowKindBefore:incomingBefore.kind,inflowKindAfter:into.kind,categoryBefore:beforeCategories.get(before.categoryId??'')?.name??null,categoryAfter:afterCategories.get(out.categoryId??'')?.name??null,categoryCreated:!!categoryToCreate&&out.categoryId===categoryToCreate.id,from:{id:from.id,name:from.name,currency:from.currency,date:out.date,amount:out.amount},to:{id:to.id,name:to.name,currency:to.currency,date:into.date,amount:into.amount},rate:rateText(quote)});}
 const affected=new Set(changes.flatMap(c=>[c.from.id,c.to.id])),accounts=state.accounts.filter(a=>affected.has(a.id)).map(a=>({id:a.id,name:a.name,currency:a.currency,before:accountBalance(a,state,asOf),after:accountBalance(a,next,asOf),principalOnlyLoan:a.type==='loan'&&a.loanReplay===1&&!!a.loanTerms?.principalOnlyTransfers}));
 const closedStatements=state.accountStatements.filter(s=>s.completedAt&&changes.some(c=>[c.from,c.to].some(l=>l.id===s.accountId&&l.date<=s.periodEnd))).map(s=>({id:s.id,title:s.title}));
 // Random persistence IDs must not participate in a preview/commit receipt.
 const reviewChanges=changes.map(({id,...row})=>({...row,transferId:writeOperation==='scan'?null:id}));
 return {next,changes,rejections,categoryToCreate,writeOperation,review:{operation:options.operation,writeOperation,enabledBefore,enabledAfter,preferenceChanged,scanBlocked:writeOperation==='scan'&&!enabledAfter,pendingBefore:state.transferDetails.filter(d=>d.status==='pending').length,pendingAfter:next.transferDetails.filter(d=>d.status==='pending').length,accountId:options.accountId??null,reviewedOn:asOf,changes:reviewChanges,total:changes.length,accounts,closedStatements}};
}
export function automaticTransferPage(review:ReturnType<typeof planAutomaticTransfers>['review'],offset=0){if(!Number.isSafeInteger(offset)||offset<0||offset%25||offset>20000||offset!==0&&offset>=review.total)throw new Error('Choose an available page of pending matches.');return {...review,changes:review.changes.slice(offset,offset+25),offset};}
export type AutomaticTransferReview=ReturnType<typeof automaticTransferPage>&{expectedRevision:number;receipt:string};
