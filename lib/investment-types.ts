import type { Currency } from './finance.ts';
export interface Security { id:string; ownerId:string; ticker:string; name:string; exchange:string; kind:'standard'|'cash'; websiteUrl:string|null; }
export interface SecurityPrice { id:string; ownerId:string; securityId:string; date:string; currency:Currency; price:string; }
export const TRADE_ACTIVITIES=['buy','sell','reinvestment','transfer_in','transfer_out','sweep_in','sweep_out','dividend','interest','fee','cash','unclassified','contribution','withdrawal','exchange','other'] as const;
export type TradeActivity=typeof TRADE_ACTIVITIES[number];
export interface Trade { excluded?:0|1|null; conversion?:TradeConversion|null; id:string; ownerId:string; accountId:string; securityId:string; date:string; name:string; qty:string; price:string; fee:number; cashAmount:number; currency:Currency; activity:TradeActivity; sequence:number; notes:string; importKey:string|null; }
export interface HoldingSnapshot { conversion?:HoldingConversion|null; id:string; ownerId:string; accountId:string; securityId:string; date:string; qty:string; price:string; amount:number; currency:Currency; costBasis:string|null; costBasisSource:'manual'|'provider'|'calculated'|null; costBasisLocked:number; securityLocked:number; }
export interface SecuritySplit { id:string; ownerId:string; securityId:string; date:string; numerator:number; denominator:number; }
export interface InvestmentCashBalance { id:string; ownerId:string; accountId:string; date:string; amount:number; }

export interface InvestmentQuote {date:string;fromCurrency:Currency;toCurrency:Currency;rateNumerator:string;rateDenominator:string;rateDate:string|null;rateSource:'saved'|'inverse'|'manual'|'imported';}
export interface TradeConversion extends InvestmentQuote {qty:string;sourcePrice:string;sourceFee:number;sourceCashAmount:number;requestFingerprint:string|null;}
export interface HoldingConversion extends InvestmentQuote {qty:string;sourcePrice:string;sourceAmount:number;sourceCostBasis:string|null;costBasisAmount:number|null;}
