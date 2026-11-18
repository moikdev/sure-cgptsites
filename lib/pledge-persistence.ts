import {snake} from './investment-persistence';
export const pledgeFields=['id','ownerId','goalId','accountId','amount','currency','kind','status','createdAt','expiresAt','updatedAt','matchedEventId','matchedTransactionId','matchedValuationId','matchedDate','matchedAmount','matchedAt','matchedSourceName','matchedPriorBalance','matchedNewBalance','matchedConversion'] as const;
export const pledgeColumns=pledgeFields.map(snake),pledgeSelect=pledgeFields.map(f=>`${snake(f)} AS ${f}`).join(', ');
export function pledgeValues(input:unknown){const row=input as Record<string,unknown>;return pledgeFields.map(f=>f==='matchedConversion'?(row[f]?JSON.stringify(row[f]):null):(row[f]??null) as string|number|null);}
