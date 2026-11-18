import {accountBalance,today,type Account,type FinanceState} from './finance.ts';
import {investmentAccountBalance} from './portfolio.ts';import {decimalAtoms,roundDivide,QTY_SCALE} from './decimal.ts';
export type ProgressBasis='balance'|'contributions';
export interface ContributionIssue {date:string;reason:string;}
const integer=(value:bigint)=>value>BigInt(Number.MAX_SAFE_INTEGER)||value< -BigInt(Number.MAX_SAFE_INTEGER)?null:Number(value);
function calculateContributions(state:FinanceState,account:Account,asOf=today()){
 const total=accountBalance(account,state,asOf);if(!['investment','crypto'].includes(account.type))return {amount:Math.max(0,total),raw:total,total,marketGain:0,checkpoint:null,issues:[] as ContributionIssue[]};
 if(asOf<account.openingDate)return {amount:0,raw:0,total:0,marketGain:0,checkpoint:null,issues:[] as ContributionIssue[]};
 const checkpoint=state.contributionBalances.filter(b=>b.accountId===account.id&&b.date>=account.openingDate&&b.date<=asOf).sort((a,b)=>b.date.localeCompare(a.date)||b.id.localeCompare(a.id))[0]??null;
 const current=investmentAccountBalance(account,state,asOf),cashAtCheckpoint=checkpoint?investmentAccountBalance(account,state,checkpoint.date).cash:0;
 const trades=state.trades.filter(t=>t.accountId===account.id&&t.date>=account.openingDate&&t.date<=asOf),after=(date:string)=>!checkpoint||date>checkpoint.date;
 // Sure's daily market flows are holdings(end)-holdings(start) minus the
 // inverse cash of nonzero-share trades. The holdings differences telescope:
 // contributions = current cash + cumulative inverse trade cash. A dated
 // checkpoint restarts this identity at its declared net-contribution amount.
 const rawBig=(checkpoint?BigInt(checkpoint.amount)-BigInt(cashAtCheckpoint):0n)+BigInt(current.cash)+trades.filter(t=>after(t.date)&&decimalAtoms(t.qty,QTY_SCALE)!==0n).reduce((sum,t)=>sum-BigInt(t.cashAmount),0n);
 const issues:ContributionIssue[]=[],quantities=new Map<string,bigint>(),relevant=new Set([...trades.map(t=>t.securityId),...state.holdingSnapshots.filter(h=>h.accountId===account.id&&h.date>=account.openingDate&&h.date<=asOf).map(h=>h.securityId)]);
 type Event={date:string;rank:number;sequence:number;id:string;securityId:string;qty?:string;cashAmount?:number;movement?:boolean;numerator?:number;denominator?:number};
 const events:Event[]=[...trades.map(t=>({date:t.date,rank:1,sequence:t.sequence,id:t.id,securityId:t.securityId,qty:t.qty,cashAmount:t.cashAmount,movement:['transfer_in','transfer_out','sweep_in','sweep_out'].includes(t.activity)})),...state.holdingSnapshots.filter(h=>h.accountId===account.id&&h.date>=account.openingDate&&h.date<=asOf).map(h=>({date:h.date,rank:2,sequence:0,id:h.id,securityId:h.securityId,qty:h.qty})),...state.securitySplits.filter(s=>relevant.has(s.securityId)&&s.date>=account.openingDate&&s.date<=asOf).map(s=>({date:s.date,rank:0,sequence:0,id:s.id,securityId:s.securityId,numerator:s.numerator,denominator:s.denominator}))].sort((a,b)=>a.date.localeCompare(b.date)||a.rank-b.rank||a.sequence-b.sequence||a.id.localeCompare(b.id));
 for(const e of events){let qty=quantities.get(e.securityId)??0n;if(e.rank===0)qty=roundDivide(qty*BigInt(e.numerator!),BigInt(e.denominator!));else{const change=decimalAtoms(e.qty!,QTY_SCALE);if(e.rank===2){if(change!==qty&&after(e.date))issues.push({date:e.date,reason:'A holding observation changes the share count without a complete cash/trade history.'});qty=change;}else{if(change!==0n&&after(e.date)&&(e.movement||e.cashAmount===0||change>0n&&e.cashAmount!>0||change<0n&&e.cashAmount!<0))issues.push({date:e.date,reason:'A security movement has no reliable contribution value. Record a checkpoint after reviewing it.'});qty+=change;}}quantities.set(e.securityId,qty);}
 const raw=integer(rawBig);if(raw===null)issues.push({date:asOf,reason:'Net contributions exceed the supported exact money range.'});
 const unique=[...new Map(issues.map(i=>[JSON.stringify(i),i])).values()];return {amount:unique.length||raw===null?null:Math.max(0,raw),raw,total,marketGain:raw===null?null:integer(BigInt(total)-rawBig),checkpoint,issues:unique};
}
export function validateContributionBalances(state:FinanceState){const ids=new Set<string>(),dates=new Set<string>(),accounts=new Map(state.accounts.map(a=>[a.id,a]));for(const b of state.contributionBalances){if(ids.has(b.id))throw new Error('Duplicate contribution checkpoint identifiers.');ids.add(b.id);const a=accounts.get(b.accountId);if(!a||!['investment','crypto'].includes(a.type))throw new Error('Contribution checkpoints need an investment or crypto account.');if(b.date<a.openingDate)throw new Error('A contribution checkpoint precedes its account opening date.');const key=JSON.stringify([b.accountId,b.date]);if(dates.has(key))throw new Error('An account has more than one contribution checkpoint on the same date.');dates.add(key);}}

const contributionCache=new WeakMap<FinanceState,Map<string,ReturnType<typeof calculateContributions>>>();
export function investmentContributions(state:FinanceState,account:Account,asOf=today()){
 if(!['investment','crypto'].includes(account.type))return calculateContributions(state,account,asOf);
 let cache=contributionCache.get(state);if(!cache){cache=new Map();contributionCache.set(state,cache);}const key=JSON.stringify([account.id,asOf,account.openingBalance,account.openingDate,account.currency,account.type]),found=cache.get(key);if(found)return found;
 const result=calculateContributions(state,account,asOf);cache.set(key,result);if(cache.size>256)cache.delete(cache.keys().next().value!);return result;
}
