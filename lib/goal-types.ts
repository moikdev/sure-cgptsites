import type {Currency} from './finance.ts';
import type {GoalConversion} from './goal-fx.ts';
export interface SavingsGoal {progressBasis?:'balance'|'contributions';id:string;ownerId:string;name:string;currency:Currency;targetAmount:number;targetDate:string|null;kind:'one_off'|'maintained';state:'active'|'paused'|'completed'|'archived';targetMode:'fixed'|'months_of_expenses';targetMonths:number|null;consumedAmount:number;completedAmount:number|null;completedAt:string|null;color:string;notes:string;}
export interface GoalAccount {id:string;ownerId:string;goalId:string;accountId:string;allocatedAmount:number|null;}
export interface GoalConsumption {conversion?:GoalConversion|null;id:string;ownerId:string;goalId:string;accountId:string;transactionId:string|null;amount:number;date:string;notes:string;}
