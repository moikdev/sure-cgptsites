import type {Currency} from './finance.ts';
export type ReconciledStatus='unreconciled'|'cleared'|'reconciled';
export interface AdjustmentSnapshot {id:string;accountId:string;date:string;amount:number;name:string|null;kind:'reconciliation'|'opening_anchor'|'current_anchor'|'history'|null;}
export interface AccountStatement {id:string;ownerId:string;accountId:string;title:string;currency:Currency;periodStart:string;periodEnd:string;openingBalance:number|null;closingBalance:number|null;notes:string;createdAt:string;completedAt:string|null;snapshotOpening:number|null;snapshotClosing:number|null;reviewRequired:0|1;adjustmentType:'valuation'|'investment_cash'|null;adjustmentId:string|null;adjustmentBefore:AdjustmentSnapshot|null;adjustmentAfter:AdjustmentSnapshot|null;}
