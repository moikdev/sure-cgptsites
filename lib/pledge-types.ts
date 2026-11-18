import type {Currency} from './finance.ts';
import type {GoalConversion} from './goal-fx.ts';
export interface GoalPledge {
 matchedConversion?:GoalConversion|null;
 id:string;ownerId:string;goalId:string;accountId:string;amount:number;currency:Currency;kind:'transfer'|'manual_save';status:'open'|'matched'|'cancelled'|'expired';createdAt:string;expiresAt:string;updatedAt:string;
 matchedEventId:string|null;matchedTransactionId:string|null;matchedValuationId:string|null;matchedDate:string|null;matchedAmount:number|null;matchedAt:string|null;matchedSourceName:string|null;matchedPriorBalance:number|null;matchedNewBalance:number|null;
}
