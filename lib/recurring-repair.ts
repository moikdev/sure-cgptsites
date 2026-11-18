import type {FinanceState,RecurringEntry,Transaction,Currency} from './finance.ts';
import {matcherKnownNames,normalizeMatcherName} from './recurring-matcher.ts';
import {sourceClaim} from './recurring-fx.ts';

export function repairRecurringIdentity(state:FinanceState,entry:RecurringEntry,transaction:Transaction){
 if(entry.billType==='transfer')return transaction.amount<0&&!!transaction.transferId&&state.transactions.some(t=>t.id!==transaction.id&&t.transferId===transaction.transferId&&t.accountId===entry.destinationAccountId);
 if(entry.merchantId&&transaction.merchantId)return transaction.merchantId===entry.merchantId;
 const name=normalizeMatcherName(transaction.name);return [...matcherKnownNames(entry)].some(known=>name===known||name.startsWith(known)||known.startsWith(name));
}
export interface RecurringRepairDetail {allocationId:string;recurringEntryId:string;seriesName:string;transactionId:string;transactionName:string;date:string;currency:Currency;sourceValue:number;candidateCount:number;usedSavedDate:boolean;}
/** Restore only the source pointer; monetary, quote, closure and scoring evidence are immutable. */
export function planRecurringRepairs(state:FinanceState){
 const next=structuredClone(state),occurrences=new Map(next.recurringOccurrences.map(o=>[o.id,o])),entries=new Map(next.recurringEntries.map(e=>[e.id,e])),accounts=new Map(next.accounts.map(a=>[a.id,a])),claimed=new Set(next.recurringAllocations.flatMap(a=>a.transactionId?[a.transactionId]:[])),details:RecurringRepairDetail[]=[],issues:string[]=[];
 const sourceOrder=new Map(next.transactions.map((t,i)=>[t.id,i])),index=new Map<string,Transaction[]>();for(const t of next.transactions){const currency=accounts.get(t.accountId)?.currency;if(!currency)continue;const key=JSON.stringify([currency,t.date,Math.abs(t.amount)]),rows=index.get(key)??[];rows.push(t);index.set(key,rows);}
 let orphanCount=0,comparisons=0;
 for(const allocation of next.recurringAllocations){if(allocation.transactionId||!['auto_matched','user_confirmed'].includes(allocation.source))continue;orphanCount++;const occurrence=occurrences.get(allocation.occurrenceId),entry=occurrence&&entries.get(occurrence.recurringEntryId);if(!entry)continue;
  const currency=allocation.sourceCurrency??allocation.currency,date=allocation.conversion?.sourceDate??allocation.paidOn,amounts=[...new Set([allocation.sourceAmount,allocation.amount].filter((n):n is number=>n!==null))];if(!date)continue;
  const candidates:Transaction[]=[];for(const amount of amounts)for(const t of index.get(JSON.stringify([currency,date,amount]))??[]){if(++comparisons>1000000)throw new Error('Deleted-entry repair exceeds one million comparisons. Review or reduce old payment history first.');if(candidates.some(c=>c.id===t.id)||claimed.has(t.id)||entry.accountId&&entry.accountId!==t.accountId||allocation.conversion&&allocation.conversion.accountId!==t.accountId)continue;
   if(next.recurringMatchRejections.some(r=>r.recurringEntryId===entry.id&&r.transactionId===t.id&&r.splitLineId===null))continue;
   const claim=sourceClaim(allocation,currency);if(claim===null||claim>Math.abs(t.amount)||!repairRecurringIdentity(next,entry,t))continue;candidates.push(t);
  }
  // Keep the source's first-match behavior, exposing all competing candidate counts for review.
  candidates.sort((a,b)=>sourceOrder.get(a.id)!-sourceOrder.get(b.id)!);const replacement=candidates[0];if(!replacement)continue;if(details.length>=300)throw new Error('Deleted-entry repair would change more than 300 payments. Review or reduce old payment history first.');allocation.transactionId=replacement.id;allocation.splitLineId=null;claimed.add(replacement.id);
  details.push({allocationId:allocation.id,recurringEntryId:entry.id,seriesName:entry.name,transactionId:replacement.id,transactionName:replacement.name,date:replacement.date,currency,sourceValue:replacement.amount,candidateCount:candidates.length,usedSavedDate:!!allocation.conversion&&allocation.conversion.sourceDate!==allocation.paidOn});
 }
 const ambiguous=details.filter(d=>d.candidateCount>1).length;if(ambiguous)issues.push(`${ambiguous} repaired payment(s) have more than one related exact-date/amount entry. Review the selected first replacement before saving.`);
 return {next,details,orphanCount,unresolved:orphanCount-details.length,comparisons,issues};
}
