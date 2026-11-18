import {pledgeFields} from './pledge-persistence';
import {snake} from './investment-persistence';
export const goalCollections={goals:{table:'goals',fields:['id','ownerId','name','currency','progressBasis','targetAmount','targetDate','kind','state','targetMode','targetMonths','consumedAmount','completedAmount','completedAt','color','notes']},goalAccounts:{table:'goal_accounts',fields:['id','ownerId','goalId','accountId','allocatedAmount']},goalConsumptions:{table:'goal_consumptions',fields:['id','ownerId','goalId','accountId','transactionId','amount','date','notes','conversion']},goalPledges:{table:'goal_pledges',fields:pledgeFields}} as const;
export type GoalCollection=keyof typeof goalCollections;
export const goalColumns=(key:GoalCollection)=>goalCollections[key].fields.map(snake);
export const goalSelect=(key:GoalCollection)=>goalCollections[key].fields.map(f=>`${snake(f)} AS ${f}`).join(', ');
export function goalValues(key:GoalCollection,input:unknown){const row=input as Record<string,unknown>;return goalCollections[key].fields.map(f=>f==='conversion'||f==='matchedConversion'?(row[f]?JSON.stringify(row[f]):null):(row[f]??null) as string|number|null);}

export function decodeGoalRow(key:GoalCollection,input:unknown){const row=input as Record<string,unknown>;const field=key==='goalConsumptions'?'conversion':key==='goalPledges'?'matchedConversion':null;return field?{...row,[field]:typeof row[field]==='string'?JSON.parse(row[field] as string):row[field]??null}:row;}
