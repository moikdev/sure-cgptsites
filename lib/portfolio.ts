import {isRecordedTradeActivity,pricedTradeAtoms} from './trade-activity.ts';
import {selectPositionQuote,foreignMarketPrice,type MarketConversion} from './market-fx.ts';
import {validateBaseTrade} from './investment-trade.ts';
import {validateTradeConversion} from './investment-fx.ts';
import {precision,sumMinorUnits,today,type Account,type Currency,type FinanceState} from './finance.ts';
import {decimalAtoms,decimalString,pow10,QTY_SCALE,PRICE_SCALE,roundDivide,safeMinorUnits,quantityValue} from './decimal.ts';
import type {Trade,HoldingSnapshot,SecuritySplit} from './investment-types.ts';
const Q=pow10(QTY_SCALE),P=pow10(PRICE_SCALE),C=Q*P;
const abs=(v:bigint)=>v<0n?-v:v;
const movement=new Set(['transfer_in','transfer_out','sweep_in','sweep_out']);
export {tradeCash} from './investment-trade.ts';
export function validateTrade(trade:Pick<Trade,'qty'|'price'|'fee'|'cashAmount'|'currency'|'activity'|'conversion'>&{date?:string}){if(trade.conversion)validateTradeConversion(trade);else validateBaseTrade(trade);}
export interface PortfolioLot {sourceId:string; acquiredOn:string; qty:string; unitCost:string|null; source:'trade'|'snapshot';}
export interface RealizedDisposal {tradeId:string; date:string; qty:string; proceeds:number; cost:number|null; gain:number|null; reason:string|null;}
export interface Position {priceConversion?:MarketConversion;accountId:string;securityId:string;currency:Currency;qty:string;price:string|null;priceDate:string|null;value:number;averageCost:string|null;cost:number|null;unrealized:number|null;lots:PortfolioLot[];disposals:RealizedDisposal[];unknownBasis:boolean;}
interface Lot {sourceId:string;acquiredOn:string;qty:bigint;unitCost:bigint|null;source:'trade'|'snapshot';}
function buildPosition(state:FinanceState,account:Account,securityId:string,asOf:string):Position {
 const trades=state.trades.filter(t=>t.accountId===account.id&&t.securityId===securityId&&t.date<=asOf&&t.date>=account.openingDate).sort((a,b)=>a.date.localeCompare(b.date)||a.sequence-b.sequence||a.id.localeCompare(b.id));
 const snapshots=state.holdingSnapshots.filter(h=>h.accountId===account.id&&h.securityId===securityId&&h.date<=asOf&&h.date>=account.openingDate);
 const splits=state.securitySplits.filter(s=>s.securityId===securityId&&s.date<=asOf).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
 type Event={date:string;rank:number;order:number;id:string;trade?:Trade;holding?:HoldingSnapshot;split?:SecuritySplit};
 const events:Event[]=[...trades.map(trade=>({date:trade.date,rank:1,order:trade.sequence,id:trade.id,trade})),...snapshots.map(holding=>({date:holding.date,rank:2,order:0,id:holding.id,holding})),...splits.filter(s=>s.date>=account.openingDate).map(split=>({date:split.date,rank:0,order:0,id:split.id,split}))].sort((a,b)=>a.date.localeCompare(b.date)||a.rank-b.rank||a.order-b.order||a.id.localeCompare(b.id));
 let qty=0n,cost=0n,unknown=false;let lots:Lot[]=[];const closed:Lot[]=[],disposals:RealizedDisposal[]=[];
 const moneyAtoms=pow10(QTY_SCALE+PRICE_SCALE-precision(account.currency));
 function restate(target:bigint){
  const open=lots.reduce((s,l)=>s+l.qty,0n);if(!open)return;
  const changed=lots.map(l=>({...l,qty:roundDivide(l.qty*target,open)}));let drift=target-changed.reduce((s,l)=>s+l.qty,0n);
  for(let i=changed.length-1;i>=0&&drift!==0n;i--){const correction=drift>0n?drift:-((-drift)<changed[i].qty?-drift:changed[i].qty);changed[i].qty+=correction;drift-=correction;}
  lots=changed.filter(l=>l.qty>0n);closed.push(...changed.filter(l=>l.qty===0n));
 }
 for(const event of events){
  if(event.split){const s=event.split;qty=roundDivide(qty*BigInt(s.numerator),BigInt(s.denominator));const open=lots.reduce((n,l)=>n+l.qty,0n),target=roundDivide(open*BigInt(s.numerator),BigInt(s.denominator));for(const lot of lots)if(lot.unitCost!==null)lot.unitCost=roundDivide(lot.unitCost*BigInt(s.denominator),BigInt(s.numerator));restate(target);continue;}
  if(event.holding){const h=event.holding,next=decimalAtoms(h.qty,QTY_SCALE),basis=h.costBasis===null?null:decimalAtoms(h.costBasis,PRICE_SCALE),known=basis!==null&&(basis>0n||!!h.costBasisLocked||!!h.conversion?.sourceCostBasis&&decimalAtoms(h.conversion.sourceCostBasis,PRICE_SCALE)>0n),same=next===qty;
   const override=known&&(!same||unknown||h.costBasisLocked||h.costBasisSource==='provider');
   if(!same){closed.push(...lots.map(l=>({...l,qty:0n})));lots=next>0n?[{sourceId:h.id,acquiredOn:h.date,qty:next,unitCost:known?basis:null,source:'snapshot'}]:[];cost=known&&next>0n?(h.conversion?.costBasisAmount===null||h.conversion?.costBasisAmount===undefined?next*basis!:BigInt(h.conversion.costBasisAmount)*moneyAtoms):0n;unknown=next!==0n&&!known;}
   else if(override){cost=next>0n?(h.conversion?.costBasisAmount===null||h.conversion?.costBasisAmount===undefined?next*basis!:BigInt(h.conversion.costBasisAmount)*moneyAtoms):0n;unknown=false;lots=lots.map(l=>({...l,unitCost:basis}));}
   else if(next===0n){cost=0n;unknown=false;}
   qty=next;continue;
  }
  const t=event.trade!,change=decimalAtoms(t.qty,QTY_SCALE);if(!change)continue;
  const old=qty,next=qty+change,unit=decimalAtoms(t.price,PRICE_SCALE),isMovement=movement.has(t.activity),unclassified=t.activity==='unclassified';
  if(change>0n){
   const covered=old<0n?(change< -old?change:-old):0n,added=change-covered;
   const acquisition=isRecordedTradeActivity(t.activity)?pricedTradeAtoms(t,'acquisition'):t.conversion?-BigInt(t.cashAmount)*moneyAtoms:change*unit+BigInt(t.fee)*moneyAtoms,addedCost=roundDivide(acquisition*added,change);
   if(added>0n){cost+=addedCost;lots.push({sourceId:t.id,acquiredOn:t.date,qty:added,unitCost:isMovement||unclassified?null:roundDivide(acquisition,change),source:'trade'});}
   if(old<=0n&&next>0n)unknown=isMovement||unclassified;
   if((isMovement||unclassified)&&next>0n)unknown=true;
  }else{
   const sold=-change,open=old>0n?old:0n,relieved=sold<open?sold:open,basis=unknown||sold>open||!open?null:roundDivide(cost*relieved,open);
   if(!isMovement){const proceeds=isRecordedTradeActivity(t.activity)?safeMinorUnits(roundDivide(pricedTradeAtoms(t,'proceeds'),moneyAtoms)):t.cashAmount,realizedCost=basis===null?null:safeMinorUnits(roundDivide(basis,moneyAtoms));const reason=unclassified?'Classify this imported activity to calculate its gain.':basis===null?'Cost basis is unknown or this disposal exceeds the long position.':null;disposals.push({tradeId:t.id,date:t.date,qty:decimalString(sold,QTY_SCALE),proceeds,cost:realizedCost,gain:reason||realizedCost===null?null:safeMinorUnits(BigInt(proceeds)-BigInt(realizedCost)),reason});}
   if(open){cost-=roundDivide(cost*relieved,open);restate(open-relieved);}
   if(next<=0n){cost=0n;unknown=next<0n;}
  }
  qty=next;if(qty===0n){cost=0n;unknown=false;}
 }
 const quote=selectPositionQuote(state,account,securityId,asOf,trades,snapshots);let value=0,price:string|null=null,priceConversion:MarketConversion|undefined;
 if(quote&&(qty!==0n||quote.currency===account.currency)){let numerator=decimalAtoms(quote.price,PRICE_SCALE),denominator=1n;if(quote.currency!==account.currency){const converted=foreignMarketPrice(state,{id:quote.sourceId!,price:quote.price,currency:quote.currency,date:quote.date},account.currency);numerator=converted.numerator;denominator=converted.denominator;priceConversion=converted.conversion;}const subsequent=splits.filter(s=>s.date>quote.date);for(const s of subsequent){numerator*=BigInt(s.denominator);denominator*=BigInt(s.numerator);}price=decimalString(roundDivide(numerator,denominator),PRICE_SCALE);let observedQty=quote.holding?decimalAtoms(quote.holding.qty,QTY_SCALE):null;if(quote.holding?.conversion)for(const split of subsequent)observedQty=roundDivide(observedQty!*BigInt(split.numerator),BigInt(split.denominator));value=quote.holding&&observedQty===qty&&(!subsequent.length||!!quote.holding.conversion)?quote.holding.amount:safeMinorUnits(roundDivide(qty*numerator,denominator*moneyAtoms));}
 else if(!quote&&qty!==0n)throw new Error('A position has no price on or before the requested date.');
 const costMinor=qty>0n&&!unknown?safeMinorUnits(roundDivide(cost,moneyAtoms)):null;
 return {...(priceConversion?{priceConversion}:{}),accountId:account.id,securityId,currency:account.currency,qty:decimalString(qty,QTY_SCALE),price,priceDate:quote?.date??null,value,averageCost:qty>0n&&!unknown?decimalString(roundDivide(cost,qty),PRICE_SCALE):null,cost:costMinor,unrealized:costMinor===null?null:safeMinorUnits(BigInt(value)-BigInt(costMinor)),lots:[...closed,...lots].map(l=>({...l,qty:decimalString(l.qty,QTY_SCALE),unitCost:l.unitCost===null?null:decimalString(l.unitCost,PRICE_SCALE)})),disposals,unknownBasis:qty!==0n&&costMinor===null};
}
const cache=new WeakMap<FinanceState,Map<string,Position[]>>();
export function accountPositions(state:FinanceState,account:Account,asOf=today()){
 let memo=cache.get(state);if(!memo){memo=new Map();cache.set(state,memo);}const key=JSON.stringify([account.id,asOf]);const found=memo.get(key);if(found)return found;
 const ids=new Set([...state.trades.filter(t=>t.accountId===account.id&&t.date<=asOf).map(t=>t.securityId),...state.holdingSnapshots.filter(h=>h.accountId===account.id&&h.date<=asOf).map(h=>h.securityId)]);
 const result=[...ids].map(id=>buildPosition(state,account,id,asOf));memo.set(key,result);if(memo.size>8)memo.delete(memo.keys().next().value!);return result;
}
export function investmentAccountBalance(account:Account,state:FinanceState,asOf=today()){
 if(account.openingDate>asOf)return {cash:0,holdings:0,total:0};
 const valuation=state.valuations.filter(v=>v.accountId===account.id&&v.date>=account.openingDate&&v.date<=asOf).sort((a,b)=>b.date.localeCompare(a.date))[0];
 const cashAnchor=state.investmentCashBalances.filter(v=>v.accountId===account.id&&v.date>=account.openingDate&&v.date<=asOf).sort((a,b)=>b.date.localeCompare(a.date))[0];
 const useCash=!!cashAnchor&&(!valuation||cashAnchor.date>=valuation.date),anchor=useCash?cashAnchor:valuation,date=anchor?.date??account.openingDate;
 const holdings=sumMinorUnits(accountPositions(state,account,asOf).map(p=>p.value));
 const baseline=useCash?cashAnchor!.amount:valuation?sumMinorUnits([valuation.amount,-sumMinorUnits(accountPositions(state,account,valuation.date).map(p=>p.value))]):account.openingBalance;
 const after=(d:string)=>d<=asOf&&(anchor?d>date:d>=date);
 const cash=sumMinorUnits([baseline,...state.transactions.filter(t=>t.accountId===account.id&&after(t.date)).map(t=>t.amount),...state.trades.filter(t=>t.accountId===account.id&&after(t.date)).map(t=>t.cashAmount)]);
 return {cash,holdings,total:sumMinorUnits([cash,holdings])};
}
export function portfolioSummary(state:FinanceState,currency:Currency,asOf=today(),accountId?:string){const accounts=state.accounts.filter(a=>['investment','crypto'].includes(a.type)&&a.currency===currency&&!a.excludedFromReports&&(!accountId||a.id===accountId));const positions=accounts.flatMap(a=>accountPositions(state,a,asOf)),balances=accounts.map(a=>investmentAccountBalance(a,state,asOf)),excludedTrades=new Set(state.trades.filter(t=>t.excluded).map(t=>t.id)),disposals=positions.flatMap(p=>p.disposals).filter(d=>!excludedTrades.has(d.tradeId));return{accounts,positions,cash:sumMinorUnits(balances.map(b=>b.cash)),holdings:sumMinorUnits(balances.map(b=>b.holdings)),total:sumMinorUnits(balances.map(b=>b.total)),unrealized:sumMinorUnits(positions.map(p=>p.unrealized??0)),unknownPositions:positions.filter(p=>p.unknownBasis).length,realized:sumMinorUnits(disposals.map(d=>d.gain??0)),unknownDisposals:disposals.filter(d=>d.gain===null).length};}
