import type {FinanceState} from './finance.ts';
import {transferMatchCandidates,transferPairWithinTolerance} from './transfer-match.ts';
export const transferPairKey=(outflowTransactionId:string,inflowTransactionId:string)=>JSON.stringify([outflowTransactionId,inflowTransactionId]);
export function transferHintPairs(state:FinanceState,transactionIds:string[]){
  const byId=new Map(state.transactions.map(t=>[t.id,t])),rejected=new Set(state.transferMatchRejections.map(r=>transferPairKey(r.outflowTransactionId,r.inflowTransactionId))),pairs=new Map<string,{outflowTransactionId:string;inflowTransactionId:string}>();
  for(const id of new Set(transactionIds)){
    const t=byId.get(id);if(!t||!['standard','one_time'].includes(t.kind)||t.transferId)continue;
    for(const candidate of transferMatchCandidates(state,id)){
      if(candidate.daysApart>2||!candidate.sameCategory)continue;const other=byId.get(candidate.transactionId)!,out=t.amount<0?t:other,into=t.amount>0?t:other,key=transferPairKey(out.id,into.id);
      if(rejected.has(key)||!transferPairWithinTolerance(state,out,into,300))continue;
      pairs.set(key,{outflowTransactionId:out.id,inflowTransactionId:into.id});
    }
  }
  return [...pairs.values()].sort((a,b)=>a.outflowTransactionId.localeCompare(b.outflowTransactionId)||a.inflowTransactionId.localeCompare(b.inflowTransactionId));
}
