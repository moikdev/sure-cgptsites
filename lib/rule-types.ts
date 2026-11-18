import type {Currency} from './finance.ts';
export type RuleField='name'|'notes'|'amount'|'type'|'categoryId'|'merchantId'|'tagIds'|'accountId';
export type RuleOperator='like'|'not_like'|'matches_regex'|'starts_with'|'ends_with'|'='|'!='|'is_null'|'is_not_null'|'>'|'>='|'<'|'<=';
export interface RuleLeaf {field:RuleField;operator:RuleOperator;value:string;}
export type RuleCondition=RuleLeaf|{field:'group';operator:'and'|'or';conditions:RuleLeaf[]};
export interface RuleSplit {name:string;type:'fixed'|'percentage';share:string;categoryId:string|null;merchantId:string|null;tagIds:string[];}
export type RuleAction={type:'name';value:string}|{type:'categoryId'|'merchantId';value:string|null}|{type:'tagIds';value:string[]}|{type:'excluded';value:boolean}|{type:'split';splits:RuleSplit[]};
export type RuleLock='kind'|'name'|'categoryId'|'merchantId'|'tagIds'|'excluded'|'split';
export interface TransactionRule {id:string;ownerId:string;name:string;active:0|1;position:number;group:string;effectiveDate:string|null;currency:Currency|null;stopProcessing:0|1;conditions:RuleCondition[];actions:RuleAction[];blockedReason:string|null;sourceJson:string|null;}
export interface RuleRunItem {name:string;matched:number;modified:number;skipped:number;}
export interface RuleRun {id:string;ownerId:string;executedAt:string;kind:'manual'|'csv';matched:number;modified:number;skipped:number;summary:RuleRunItem[];}
export interface RuleScope {accountId?:string;from?:string;to?:string;transactionIds?:string[];}
