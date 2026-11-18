import {validDate,type RecurringEntry} from './finance.ts';import {recurringMatcherSettingsSchema} from './recurring-matcher-schema.ts';
const KEY='sites_reconstructed_history';
export function recurringHistoryFloor(entry:RecurringEntry):string|null{const value=entry.matching?.sourceHints?.[KEY];if(!value||typeof value!=='object'||Array.isArray(value))return null;const row=value as {version?:number;unpaidBefore?:string};return row.version===1&&typeof row.unpaidBefore==='string'&&validDate(row.unpaidBefore)?row.unpaidBefore:null;}
/** Pruning cannot be undone by a later virtual query; stored evidence always remains visible. */
export function withRecurringHistoryFloor(entry:RecurringEntry,date:string|null):RecurringEntry{const old=recurringHistoryFloor(entry);if(!date||old&&old>=date)return entry;return {...entry,matching:{...(entry.matching??recurringMatcherSettingsSchema.parse({})),sourceHints:{...entry.matching?.sourceHints,[KEY]:{version:1,unpaidBefore:date}}}};}
