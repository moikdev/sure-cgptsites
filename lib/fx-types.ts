import type {Currency} from './finance.ts';
export interface ExchangeRate{id:string;ownerId:string;date:string;fromCurrency:Currency;toCurrency:Currency;rate:string;notes:string;}
export interface TransferDetail{status?:'pending'|'confirmed'|null;createdAt?:string|null;updatedAt?:string|null;id:string;ownerId:string;date:string;destinationDate:string;fromCurrency:Currency;toCurrency:Currency;fromAmount:number;toAmount:number;rateNumerator:string;rateDenominator:string;rateDate:string|null;rateSource:'identity'|'manual'|'saved'|'inverse'|'imported';sourceFee:number;destinationFee:number;requestId:string|null;requestFingerprint:string|null;}
export interface TransferFee{id:string;ownerId:string;transferId:string;transactionId:string;side:'source'|'destination';}
