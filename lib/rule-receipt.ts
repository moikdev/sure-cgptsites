import {csvDigest} from './csv-digest.ts';
import type {RuleScope} from './rule-types.ts';
export interface RuleRunOptions {ruleId?:string;scope:RuleScope;ignoreLocks:boolean;}
export const ruleRunReceipt=(owner:string,revision:number,options:RuleRunOptions)=>csvDigest(JSON.stringify([owner,revision,options]));
