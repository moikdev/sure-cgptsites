import {isRecordedTradeActivity} from './trade-activity.ts';
import {precision,type Currency} from './finance.ts';
import {decimalAtoms,QTY_SCALE,PRICE_SCALE,quantityValue,safeMinorUnits} from './decimal.ts';
import type {Trade} from './investment-types.ts';
const incoming=new Set(['buy','reinvestment','transfer_in','sweep_in']),outgoing=new Set(['sell','transfer_out','sweep_out']);
const movement=new Set(['transfer_in','transfer_out','sweep_in','sweep_out']);
export function tradeCash(qty:string,price:string,fee:number,currency:Currency){return safeMinorUnits(-BigInt(quantityValue(qty,price,precision(currency)))-BigInt(fee),1_000_000_000_000);}
export function validateBaseTrade(trade:Pick<Trade,'qty'|'price'|'fee'|'cashAmount'|'currency'|'activity'>){
 const qty=decimalAtoms(trade.qty,QTY_SCALE),price=decimalAtoms(trade.price,PRICE_SCALE);
 if(price<0n||trade.fee<0)throw new Error('Price and fees cannot be negative.');
 if(incoming.has(trade.activity)&&qty<=0n||outgoing.has(trade.activity)&&qty>=0n)throw new Error('The share direction does not match this activity.');
 if(['dividend','interest','fee','cash'].includes(trade.activity)){
  if(qty!==0n||price!==0n||trade.fee!==0)throw new Error('Cash activities use an amount with zero shares, price and trade fee.');
  if(!trade.cashAmount)throw new Error('Enter a non-zero cash amount.');
  // Income charges/reversals and fee rebates retain their actual signed cash.
 }else if(!movement.has(trade.activity)&&!isRecordedTradeActivity(trade.activity)&&trade.activity!=='unclassified'&&trade.cashAmount!==tradeCash(trade.qty,trade.price,trade.fee,trade.currency))throw new Error('Trade cash must equal its signed share value and fee.');
 // Internal security movement describes ownership/cost-basis treatment, not a zero-cash assertion.
 // Retain booked net cash and the separately recorded fee; cash replay posts only cashAmount.
 // An unclassified source record can retain zero shares and its original price/cash.
 // Position replay already skips zero-share cost movements; cash still posts exactly.
 if(qty===0n&&!isRecordedTradeActivity(trade.activity)&&!['dividend','interest','fee','cash','unclassified'].includes(trade.activity))throw new Error('Choose a cash activity or enter a non-zero share quantity.');
}
