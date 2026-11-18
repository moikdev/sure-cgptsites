import {today,validDate,type Account} from './finance.ts';
export const ARCHIVE_MODES=['active_only','historical','all_balances'] as const;export type ArchiveMode=typeof ARCHIVE_MODES[number];
export function archiveParticipation(account:Pick<Account,'archived'|'archivedOn'|'openingDate'>,date:string,mode:ArchiveMode,currentDay=today()){
 if(!validDate(date)||!validDate(currentDay)||date>currentDay)throw new Error('Choose a supported historical archive date.');
 if(date<account.openingDate)return 'not_open' as const;if(!account.archived)return 'active' as const;if(mode==='active_only')return 'cutoff' as const;if(mode==='all_balances')return 'retained' as const;
 if(account.archivedOn&&(!validDate(account.archivedOn)||account.archivedOn>currentDay))throw new Error('The recorded archive date is invalid.');
 if(account.archivedOn)return date>=account.archivedOn?'cutoff' as const:'before_cutoff' as const;
 return date===currentDay?'current_status' as const:'unknown' as const;
}
export function validateArchiveDate(value:string|null,archived:boolean){if(!archived)throw new Error('Only archived accounts can have an archive date.');if(value!==null&&(!validDate(value)||value>today()))throw new Error('Choose a valid archive date through today.');return value;}
// Native Rails JSON timestamps include an offset. Do not assign a timezone to
// an ambiguous timestamp; a date-only value is already an explicit calendar day.
export function sourceArchiveDate(source:Record<string,unknown>):{archivedOn?:string;warning?:string}{
 if(source.status!=='disabled')return {};const fallback=source.disabled_at==null,value=source.disabled_at??source.updated_at;let date:string|undefined;
 if(typeof value==='string'){if(validDate(value))date=value;else{const m=/^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)$/.exec(value);if(m&&validDate(m[1])){const time=Date.parse(value);if(Number.isFinite(time)){const day=new Date(time).toISOString().slice(0,10);if(validDate(day))date=day;}}}}
 if(!date||date>today())return {warning:'Archive date is unknown: the supplied disabled_at/updated_at timestamp is missing, ambiguous, invalid or future-dated. Historical cutoff reporting will require a recorded date.'};
 return {archivedOn:date,...(fallback?{warning:'Archive date uses the supplied updated_at timestamp because disabled_at is absent, matching Sure’s fallback.'}:{})};
}
