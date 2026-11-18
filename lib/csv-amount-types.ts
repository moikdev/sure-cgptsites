import {parseCSV} from './csv.ts';
import type {CSVImportOptions} from './csv-schema.ts';

export function csvAmountTypeValues(csv:string,delimiter:CSVImportOptions['delimiter'],column:number){
 if(!Number.isInteger(column)||column<0||column>99)throw new Error('Select an amount-type column.');
 const [header,...rows]=parseCSV(csv,delimiter);if(!header||header.length>100||column>=header.length)throw new Error('The selected amount-type column is missing.');
 if(!rows.length||rows.length>10000)throw new Error('Import between 1 and 10,000 transactions.');
 const values=new Map<string,number>();for(const [index,row] of rows.entries()){if(row.length!==header.length)throw new Error(`Row ${index+2}: column count does not match the header.`);const value=row[column].trim();if(value.length>2000)throw new Error(`Row ${index+2}: amount-type values must be at most 2,000 characters.`);values.set(value,(values.get(value)??0)+1);}
 return [...values].map(([value,rows])=>({value,rows}));
}
