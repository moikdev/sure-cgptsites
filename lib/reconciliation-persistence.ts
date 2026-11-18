import {snake} from './investment-persistence';
export const statementColumns=['id','ownerId','accountId','title','currency','periodStart','periodEnd','openingBalance','closingBalance','notes','createdAt','completedAt','snapshotOpening','snapshotClosing','reviewRequired','adjustmentType','adjustmentId','adjustmentBefore','adjustmentAfter'] as const;
export const statementSqlColumns=statementColumns.map(snake),statementSelect=statementColumns.map(f=>`${snake(f)} AS ${f}`).join(', ');
export function statementValues(input:unknown){const row=input as Record<string,unknown>;return statementColumns.map(f=>(['adjustmentBefore','adjustmentAfter'].includes(f)?row[f]===null?null:JSON.stringify(row[f]):row[f]??null) as string|number|null);}
export function decodeStatement(input:unknown){const row={...input as Record<string,unknown>};for(const f of ['adjustmentBefore','adjustmentAfter'])row[f]=row[f]?JSON.parse(String(row[f])):null;return row;}
