import {reviewMarketPrices} from './market-fx.ts';
import {validateHoldingConversion} from './investment-fx.ts';
import {accountBalance,precision,sumMinorUnits,today,type FinanceState} from './finance.ts';
import {decimalAtoms,pow10,QTY_SCALE,PRICE_SCALE} from './decimal.ts';
import {validateTrade} from './portfolio.ts';
export function validateInvestmentWorkspace(state:FinanceState){
 const securities=new Map(state.securities.map(s=>[s.id,s])),accounts=new Map(state.accounts.map(a=>[a.id,a]));
 const unique=(rows:{id:string}[],label:string)=>{if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error(`Duplicate ${label} identifiers.`);};
 const seen=new Set<string>(),key=(...items:(string|number)[])=>JSON.stringify(items);
 unique(state.securities,'security');unique(state.securityPrices,'security price');unique(state.trades,'trade');unique(state.holdingSnapshots,'holding snapshot');unique(state.securitySplits,'stock split');unique(state.investmentCashBalances,'investment cash balance');
 const guard=(value:string)=>{if(seen.has(value))throw new Error('Duplicate investment record for this date or security.');seen.add(value);};
 for(const s of state.securities)guard(key('security',s.ticker.toUpperCase(),s.exchange.toUpperCase()));
 const security=(id:string)=>{if(!securities.has(id))throw new Error('An investment record references a missing security.');};
 const account=(id:string,date:string,currency?:string)=>{const a=accounts.get(id);if(!a||!['investment','crypto'].includes(a.type))throw new Error('Investment records need an investment or crypto account.');if(date<a.openingDate)throw new Error('Investment history predates its account opening.');if(currency&&a.currency!==currency)throw new Error('Investment and account currencies must match. Cross-currency investments need the FX workflow.');};
 for(const p of state.securityPrices){security(p.securityId);guard(key('price',p.securityId,p.date,p.currency));}
 for(const t of state.trades){security(t.securityId);account(t.accountId,t.date,t.currency);validateTrade(t);if(t.importKey)guard(key("import",t.accountId,t.importKey));}
 for(const h of state.holdingSnapshots){if(h.conversion)validateHoldingConversion(h);security(h.securityId);account(h.accountId,h.date,h.currency);guard(key('holding',h.accountId,h.securityId,h.date));if(Math.sign(h.amount)!==Math.sign(Number(decimalAtoms(h.qty,QTY_SCALE)))&&h.amount!==0)throw new Error('A holding value must have the same direction as its share quantity.');if(h.costBasisLocked&&h.costBasis===null)throw new Error('A locked cost basis needs a value.');if(h.costBasis!==null&&decimalAtoms(h.costBasis,PRICE_SCALE)<0n)throw new Error('A cost basis cannot be negative.');}
 for(const s of state.securitySplits){security(s.securityId);guard(key('split',s.securityId,s.date));if(s.numerator===s.denominator)throw new Error('A stock split must change the share count.');}
 for(const b of state.investmentCashBalances){account(b.accountId,b.date);guard(key('cash',b.accountId,b.date));}
 if(state.profile?.marketFx===1){const review=reviewMarketPrices(state);if(review.issueCount)throw new Error(`${review.issues[0].accountName} / ${review.issues[0].ticker}: ${review.issues[0].error} Resolve foreign market prices before saving this change.`);}
 if(!state.trades.length&&!state.holdingSnapshots.length&&!state.investmentCashBalances.length)return;
 if(investmentRangeBoundIsSafe(state))return;
 // Check every event boundary, so a future price/split cannot introduce an unsafe total later.
 const dates=new Set([today(),...state.trades.map(t=>t.date),...state.holdingSnapshots.map(h=>h.date),...state.securityPrices.map(p=>p.date),...state.securitySplits.map(s=>s.date),...state.investmentCashBalances.map(b=>b.date),...state.valuations.map(v=>v.date),...state.transactions.map(t=>t.date)]);
 const investmentAccounts=state.accounts;
 for(const date of [...dates].sort()){
  const totals=new Map<string,number[]>();for(const a of investmentAccounts){const value=accountBalance(a,state,date);if(a.excludedFromReports)continue;const group=totals.get(a.currency)??[];group.push(value);totals.set(a.currency,group);}for(const group of totals.values())sumMinorUnits(group);
 }
}

// A conservative absolute bound proves every dated result fits without replaying
// a long ledger at every date. Unusually large histories fall back to exact event checks.
function investmentRangeBoundIsSafe(state:FinanceState){
 const abs=(n:bigint)=>n<0n?-n:n,max=(a:bigint,b:bigint)=>a>b?a:b,limit=BigInt(Number.MAX_SAFE_INTEGER),currencies=new Map<string,bigint>();
 for(const account of state.accounts){
  const trades=state.trades.filter(t=>t.accountId===account.id),holdings=state.holdingSnapshots.filter(h=>h.accountId===account.id),unit=pow10(QTY_SCALE+PRICE_SCALE-precision(account.currency));
  let portfolio=0n;
  const securities=new Set([...trades.map(t=>t.securityId),...holdings.map(h=>h.securityId)]);
  for(const id of securities){
   const ownTrades=trades.filter(t=>t.securityId===id),ownHoldings=holdings.filter(h=>h.securityId===id);
   const qty=ownTrades.reduce((sum,t)=>sum+abs(decimalAtoms(t.qty,QTY_SCALE)),0n)+ownHoldings.reduce((value,h)=>max(value,abs(decimalAtoms(h.qty,QTY_SCALE))),0n);
   let price=[...ownTrades.map(t=>t.price),...ownHoldings.flatMap(h=>[h.price,...(h.costBasis===null?[]:[h.costBasis])]),...state.securityPrices.filter(p=>p.securityId===id&&p.currency===account.currency).map(p=>p.price)].reduce((value,p)=>max(value,decimalAtoms(p,PRICE_SCALE)),0n);
   if(state.profile?.marketFx===1)price=max(price,reviewMarketPrices(state).bounds.get(JSON.stringify([account.id,id]))??0n);
   let scaled=qty*price;
   for(const split of state.securitySplits.filter(s=>s.securityId===id)){
    const large=BigInt(Math.max(split.numerator,split.denominator)),small=BigInt(Math.min(split.numerator,split.denominator));
    // The larger factor covers either quantity growth or carried-price growth.
    scaled*= (large+small-1n)/small;if(scaled/unit>limit)return false;
   }
   const observed=ownHoldings.reduce((value,h)=>max(value,max(abs(BigInt(h.amount)),abs(BigInt(h.conversion?.costBasisAmount??0)))),0n);const fees=ownTrades.reduce((sum,t)=>sum+BigInt(t.fee),0n);portfolio+=observed+(scaled+unit-1n)/unit+fees;if(portfolio>limit)return false;
  }
  const flows=state.transactions.filter(t=>t.accountId===account.id).reduce((sum,t)=>sum+abs(BigInt(t.amount)),0n)+trades.reduce((sum,t)=>sum+abs(BigInt(t.cashAmount)),0n);
  const anchors=[...state.valuations.filter(v=>v.accountId===account.id),...state.investmentCashBalances.filter(b=>b.accountId===account.id)].reduce((value,a)=>max(value,abs(BigInt(a.amount))),0n);
  const bound=abs(BigInt(account.openingBalance))+anchors+flows+3n*portfolio;
  const total=(currencies.get(account.currency)??0n)+bound;if(total>limit)return false;currencies.set(account.currency,total);
 }
 return true;
}
