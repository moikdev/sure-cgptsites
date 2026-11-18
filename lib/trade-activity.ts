import {decimalAtoms,pow10,roundDivide,QTY_SCALE,PRICE_SCALE} from './decimal.ts';
import {precision} from './finance.ts';
import type {InvestmentActivity} from './investment-reporting-schema.ts';
import type {TradeActivity,Trade} from './investment-types.ts';
// These source labels describe an event independently of its signed quantity and booked cash.
export const RECORDED_TRADE_ACTIVITIES=['contribution','withdrawal','exchange','other'] as const;
export const isRecordedTradeActivity=(activity:TradeActivity)=>RECORDED_TRADE_ACTIVITIES.some(a=>a===activity);
export const TRADE_SOURCE_LABELS:Partial<Record<TradeActivity,InvestmentActivity>>={buy:'Buy',sell:'Sell',reinvestment:'Reinvestment',transfer_in:'Transfer',transfer_out:'Transfer',sweep_in:'Sweep In',sweep_out:'Sweep Out',dividend:'Dividend',interest:'Interest',fee:'Fee',contribution:'Contribution',withdrawal:'Withdrawal',exchange:'Exchange',other:'Other'};
// QTY_SCALE + PRICE_SCALE atoms of account-currency major units, before final money rounding.
// Source Holding effective_trade_price and Trade realized proceeds use price/fee, not Entry cash.
export function pricedTradeAtoms(t:Pick<Trade,'qty'|'price'|'fee'|'currency'|'conversion'>,mode:'acquisition'|'proceeds'){
 const c=t.conversion,qty=decimalAtoms(t.qty,QTY_SCALE),absolute=qty<0n?-qty:qty,price=decimalAtoms(c?.sourcePrice??t.price,PRICE_SCALE),fee=BigInt(c?.sourceFee??t.fee)*pow10(QTY_SCALE+PRICE_SCALE-precision(c?.fromCurrency??t.currency)),raw=absolute*price+(mode==='acquisition'?fee:-fee);
 return c?roundDivide(raw*BigInt(c.rateNumerator),BigInt(c.rateDenominator)):raw;
}
