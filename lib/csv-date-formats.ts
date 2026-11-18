export const CSV_DATE_FORMATS = [
  {value:'ymd',label:'YYYY-MM-DD',ruby:'%Y-%m-%d'},
  {value:'mdy',label:'MM/DD/YYYY',ruby:'%m/%d/%Y'},
  {value:'dmy',label:'DD/MM/YYYY',ruby:'%d/%m/%Y'},
  {value:'mdy-dash',label:'MM-DD-YYYY',ruby:'%m-%d-%Y'},
  {value:'dmy-dot',label:'DD.MM.YYYY',ruby:'%d.%m.%Y'},
  {value:'dmy-dash',label:'DD-MM-YYYY',ruby:'%d-%m-%Y'},
  {value:'ymd-slash',label:'YYYY/MM/DD',ruby:'%Y/%m/%d'},
  {value:'dmy-space',label:'D/MM/YYYY (space-padded day)',ruby:'%e/%m/%Y'},
  {value:'ymd-dot',label:'YYYY.MM.DD',ruby:'%Y.%m.%d'},
  {value:'ymd-compact',label:'YYYYMMDD',ruby:'%Y%m%d'},
  {value:'dmy-month',label:'DD MMM YYYY (English month)',ruby:'%d %b %Y'},
  {value:'dmy-short-year',label:'DD/MM/YY (two-digit year)',ruby:'%d/%m/%y'},
] as const;
export type CSVDateFormat = typeof CSV_DATE_FORMATS[number]['value'];
export const CSV_DATE_FORMAT_KEYS=CSV_DATE_FORMATS.map(f=>f.value) as [CSVDateFormat,...CSVDateFormat[]];
