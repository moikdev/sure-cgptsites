import {snake} from './investment-persistence';
export const ruleCollections={rules:{table:'transaction_rules',fields:['id','ownerId','name','active','position','group','effectiveDate','currency','stopProcessing','conditions','actions','blockedReason','sourceJson']},ruleRuns:{table:'rule_runs',fields:['id','ownerId','executedAt','kind','matched','modified','skipped','summary']}} as const;
export type RuleCollection=keyof typeof ruleCollections;const column=(f:string)=>f==='group'?'group_name':snake(f);
export const ruleColumns=(key:RuleCollection)=>ruleCollections[key].fields.map(column);
export const ruleSelect=(key:RuleCollection)=>ruleCollections[key].fields.map(f=>`${column(f)} AS ${f==='group'?'"group"':f}`).join(', ');
export function ruleValues(key:RuleCollection,input:unknown){const row=input as Record<string,unknown>;return ruleCollections[key].fields.map(f=>(['conditions','actions','summary'].includes(f)?JSON.stringify(row[f]):row[f]??null) as string|number|null);}
export function decodeRuleRow(key:RuleCollection,input:unknown){const row={...input as Record<string,unknown>};for(const f of key==='rules'?['conditions','actions']:['summary'])row[f]=JSON.parse(String(row[f]));return row;}
