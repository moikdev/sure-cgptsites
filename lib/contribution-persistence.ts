import {snake} from './investment-persistence';
export const contributionFields=['id','ownerId','accountId','date','amount','source','notes'] as const;
export const contributionColumns=contributionFields.map(snake),contributionSelect=contributionFields.map(f=>`${snake(f)} AS ${f}`).join(', ');
export function contributionValues(input:unknown){const row=input as Record<string,unknown>;return contributionFields.map(f=>(row[f]??null) as string|number|null);}
