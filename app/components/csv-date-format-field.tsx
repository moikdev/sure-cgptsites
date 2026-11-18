'use client';
import {CSV_DATE_FORMATS,type CSVDateFormat} from '../../lib/csv-date-formats';

export function CSVDateFormatField({value,onChange}:{value:CSVDateFormat;onChange:(value:CSVDateFormat)=>void}){
 return <><label>Date format<select value={value} onChange={e=>onChange(e.target.value as CSVDateFormat)}>{CSV_DATE_FORMATS.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}</select></label>{value==='dmy-short-year'&&<p className="form-hint" role="note">Two-digit years follow Sure’s 1969–2068 window: 00–68 mean 2000–2068; 69–99 mean 1969–1999. Check every converted date in the review before approval.</p>}</>;
}
