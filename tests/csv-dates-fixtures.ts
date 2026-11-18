import type {CSVDateFormat} from '../lib/csv-date-formats.ts';
export const dateSamples:Record<CSVDateFormat,string>={ymd:'2026-01-02',mdy:'01/02/2026',dmy:'02/01/2026','mdy-dash':'01-02-2026','dmy-dot':'02.01.2026','dmy-dash':'02-01-2026','ymd-slash':'2026/01/02','dmy-space':' 2/01/2026','ymd-dot':'2026.01.02','ymd-compact':'20260102','dmy-month':'02 Jan 2026','dmy-short-year':'02/01/26'};
export const dateEdges=[
 ['dmy-short-year','31/12/68','2068-12-31'],['dmy-short-year','01/01/69','1969-01-01'],['dmy-short-year','29/02/00','2000-02-29'],['dmy-short-year','31/12/99','1999-12-31'],
 ['dmy-month','2 january 2026','2026-01-02'],['dmy-month','29 FEBRUARY 2000','2000-02-29'],['dmy-month','30 Sep 2026','2026-09-30'],['dmy-month','31 December 1999','1999-12-31'],
 ['dmy-dot','29.2.2024','2024-02-29'],['mdy-dash','2-29-2000','2000-02-29'],['dmy-dash','29-2-2000','2000-02-29'],['ymd-slash','2000/2/29','2000-02-29'],['ymd-dot','2000.2.29','2000-02-29'],['ymd-compact','20000229','2000-02-29'],['dmy-space',' 9/02/2026','2026-02-09'],
] as const;
