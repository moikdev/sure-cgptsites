import type {Currency} from './finance.ts';
export interface BudgetBook {id:string;ownerId:string;name:string;currency:Currency;startDay:number;accountMode:'all'|'selected';accountIds:string[];sourceKind:'household'|'personal'|'custom';sourceReference:string|null;legacyCompat:0|1;}
export interface BudgetPeriod {id:string;ownerId:string;bookId:string;startDate:string;endDate:string;currency:Currency;budgetedSpending:number|null;expectedIncome:number|null;autoTotal:0|1;}
export interface BudgetEnvelope {id:string;ownerId:string;periodId:string;categoryId:string;allocated:number;rolloverEnabled:0|1;importedCarry:number|null;}
