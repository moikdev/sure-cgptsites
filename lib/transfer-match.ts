import {accountBalance,transferKind,today,type FinanceState,type Transaction} from './finance.ts';
import {findRate,impliedRate,rateText,type FxQuote} from './fx.ts';
import type {TransferDetail} from './fx-types.ts';

export interface TransferMatchOptions {operation:'link'|'unlink';transactionId:string;counterpartId?:string;}
export function transferMatchIssue(state:FinanceState,t:Transaction|undefined,unlink=false){
  if(!t)return 'Transaction not found.';
  if(t.amount===0)return 'A memo entry does not move money and cannot be a transfer principal.';
  const account=state.accounts.find(a=>a.id===t.accountId);
  if(!account||account.archived)return 'Restore the account before changing transfer links.';
  if(t.splitParentId||state.splitLines.some(l=>l.transactionId===t.id))return 'Remove the split before matching this transaction as a transfer.';
  if(t.excluded&&!unlink)return 'Include the transaction in reports before matching it as a transfer.';
  if(state.transferFees.some(f=>f.transactionId===t.id))return 'This expense belongs to another transfer as a fee.';
  if(state.recurringAllocations.some(a=>a.transactionId===t.id))return 'Remove this transaction’s recurring payment link before changing its transfer classification. Payment history is retained.';
  if(state.goalConsumptions.some(c=>c.transactionId===t.id))return 'This transaction backs recorded goal usage and must stay a standalone purchase.';
  return null;
}
const daysApart=(a:string,b:string)=>Math.abs(Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000;
function suggestionQuote(state:FinanceState,from:FinanceState['accounts'][number],to:FinanceState['accounts'][number],date:string):Pick<FxQuote,'numerator'|'denominator'>|null{
  const direct=findRate(state,from.currency,to.currency,date);if(direct)return direct;
  const base=state.profile?.currency;if(!base)return null;
  const a=findRate(state,from.currency,base,date),b=findRate(state,to.currency,base,date);
  return a&&b?{numerator:a.numerator*b.denominator,denominator:a.denominator*b.numerator}:null;
}
export function transferPairWithinTolerance(state:FinanceState,out:Transaction,into:Transaction,basisPoints=1000){const from=state.accounts.find(a=>a.id===out.accountId),to=state.accounts.find(a=>a.id===into.accountId);if(!from||!to||out.amount>=0||into.amount<=0)return false;if(from.currency===to.currency)return out.amount+into.amount===0;const quote=suggestionQuote(state,from,to,out.date);if(!quote)return false;const actual=impliedRate(-out.amount,from.currency,into.amount,to.currency),lower=BigInt(10000-basisPoints),upper=BigInt(10000+basisPoints);return actual.numerator*quote.denominator*10000n>=quote.numerator*actual.denominator*lower&&actual.numerator*quote.denominator*10000n<=quote.numerator*actual.denominator*upper;}
export function transferMatchCandidates(state:FinanceState,transactionId:string){
  const t=state.transactions.find(t=>t.id===transactionId);if(!t||t.transferId||transferMatchIssue(state,t))return [];
  const rejectedIds=new Set(state.transferMatchRejections.flatMap(r=>r.outflowTransactionId===t.id?[r.inflowTransactionId]:r.inflowTransactionId===t.id?[r.outflowTransactionId]:[]));
  const accounts=new Map(state.accounts.map(a=>[a.id,a])),barred=new Set([...state.splitLines.map(l=>l.transactionId),...state.transferFees.map(f=>f.transactionId),...state.recurringAllocations.flatMap(a=>a.transactionId?[a.transactionId]:[]),...state.goalConsumptions.flatMap(c=>c.transactionId?[c.transactionId]:[])]);
  return state.transactions.filter(other=>other.amount!==0&&other.id!==t.id&&!other.transferId&&other.accountId!==t.accountId&&Math.sign(other.amount)!==Math.sign(t.amount)&&daysApart(t.date,other.date)<=30&&!barred.has(other.id)&&!other.splitParentId&&!other.excluded&&!accounts.get(other.accountId)?.archived&&accounts.has(other.accountId)).flatMap(other=>{
    const out=t.amount<0?t:other,into=t.amount>0?t:other,from=accounts.get(out.accountId)!,to=accounts.get(into.accountId)!;
    if(from.currency===to.currency&&out.amount+into.amount!==0)return [];
    const sameCurrency=from.currency===to.currency,withinTolerance=transferPairWithinTolerance(state,out,into);
    return [{transactionId:other.id,rejected:rejectedIds.has(other.id),suggested:sameCurrency||withinTolerance,sameCurrency,sameCategory:t.categoryId===other.categoryId,daysApart:daysApart(t.date,other.date)}];
  }).sort((a,b)=>Number(a.rejected)-Number(b.rejected)||Number(b.suggested)-Number(a.suggested)||Number(b.sameCategory)-Number(a.sameCategory)||Number(b.sameCurrency)-Number(a.sameCurrency)||a.daysApart-b.daysApart||a.transactionId.localeCompare(b.transactionId));
}

export function planTransferMatch(state:FinanceState,options:TransferMatchOptions,asOf=today(),newTransferId='review-new-transfer'){
  const first=state.transactions.find(t=>t.id===options.transactionId);if(!first)throw new Error('Transaction not found.');
  const counterpart=options.operation==='link'?state.transactions.find(t=>t.id===options.counterpartId):state.transactions.find(t=>first.transferId&&t.transferId===first.transferId&&t.id!==first.id);
  if(!counterpart)throw new Error('Choose an existing counterpart transaction.');
  const legs=[first,counterpart];for(const leg of legs){const issue=transferMatchIssue(state,leg,options.operation==='unlink');if(issue)throw new Error(issue);}
  if(options.operation==='link'){
    if(legs.some(t=>t.transferId))throw new Error('One of these entries is already linked to a transfer.');
    if(first.id===counterpart.id||first.accountId===counterpart.accountId||Math.sign(first.amount)===Math.sign(counterpart.amount))throw new Error('Choose opposite movements in two different accounts.');
    if(daysApart(first.date,counterpart.date)>30)throw new Error('Transfer entries must be no more than 30 days apart.');
  }else if(!first.transferId||state.transactions.filter(t=>t.transferId===first.transferId).length!==2)throw new Error('The existing transfer pair needs review.');
  const out=legs.find(t=>t.amount<0)!,into=legs.find(t=>t.amount>0)!;
  if(!out||!into)throw new Error('A transfer needs one outgoing and one incoming entry.');
  const from=state.accounts.find(a=>a.id===out.accountId)!,to=state.accounts.find(a=>a.id===into.accountId)!;
  if(options.operation==='link'&&from.currency===to.currency&&out.amount+into.amount!==0)throw new Error('Same-currency transfer amounts must be equal and opposite. Record any actual fee separately.');
  const next=structuredClone(state),transferId=options.operation==='link'?newTransferId:first.transferId!,feeLinks=state.transferFees.filter(f=>f.transferId===transferId),oldDetail=state.transferDetails.find(d=>d.id===transferId);
  let detail:TransferDetail|null=null;
  if(options.operation==='link'){
    const quote=from.currency===to.currency?{numerator:1n,denominator:1n}:impliedRate(-out.amount,from.currency,into.amount,to.currency);
    detail={id:transferId,ownerId:out.ownerId,date:out.date,destinationDate:into.date,fromCurrency:from.currency,toCurrency:to.currency,fromAmount:-out.amount,toAmount:into.amount,rateNumerator:String(quote.numerator),rateDenominator:String(quote.denominator),rateDate:from.currency===to.currency?null:out.date,rateSource:from.currency===to.currency?'identity':'manual',sourceFee:0,destinationFee:0,requestId:null,requestFingerprint:null};
    next.transferDetails.push(detail);
    for(const leg of next.transactions)if(leg.id===out.id||leg.id===into.id){leg.transferId=transferId;leg.kind=leg.id===out.id?transferKind(from.type,to.type):'funds_movement';}
  }else{
    next.transferDetails=next.transferDetails.filter(d=>d.id!==transferId);next.transferFees=next.transferFees.filter(f=>f.transferId!==transferId);
    for(const leg of next.transactions)if(leg.id===out.id||leg.id===into.id){leg.transferId=null;if(oldDetail?.status!=='pending'){leg.kind='standard';if(leg.lockedFields)leg.lockedFields=leg.lockedFields.filter(field=>field!=='kind');}}
  }
  const affectedAccounts=[from,to].map(a=>({accountId:a.id,name:a.name,currency:a.currency,before:accountBalance(a,state,asOf),after:accountBalance(a,next,asOf),loanPrincipalOnly:a.type==='loan'&&a.loanReplay===1&&!!a.loanTerms?.principalOnlyTransfers}));
  const reviewedLegs=[out,into].map(t=>({id:t.id,name:t.name,date:t.date,accountId:t.accountId,accountName:state.accounts.find(a=>a.id===t.accountId)!.name,currency:state.accounts.find(a=>a.id===t.accountId)!.currency,amount:t.amount,beforeKind:t.kind,afterKind:next.transactions.find(n=>n.id===t.id)!.kind}));
  const statements=state.accountStatements.filter(s=>s.completedAt&&legs.some(t=>t.accountId===s.accountId&&t.date<=s.periodEnd)).map(s=>({id:s.id,title:s.title}));
  const applied=detail??oldDetail;
  return {next,detail,transferId,review:{operation:options.operation,transactionId:first.id,counterpartId:counterpart.id,reviewedOn:asOf,legs:reviewedLegs,accounts:affectedAccounts,closedStatements:statements,feesKept:feeLinks.length,rate:applied?rateText({numerator:BigInt(applied.rateNumerator),denominator:BigInt(applied.rateDenominator)}):'1'}};
}
export type TransferMatchReview=ReturnType<typeof planTransferMatch>['review']&{expectedRevision:number;receipt:string};
