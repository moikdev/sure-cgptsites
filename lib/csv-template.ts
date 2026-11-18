import {z} from 'zod';
import {CSV_FIELDS,csvImportOptionsSchema,type CSVField,type CSVImportOptions} from './csv-schema.ts';
import {parseCSV} from './csv.ts';

const label=z.string().max(2000),fieldLabels=z.object(Object.fromEntries(CSV_FIELDS.map(field=>[field,label.optional()])) as Record<CSVField,z.ZodOptional<typeof label>>).strict();
export const csvTemplateSchema=z.object({version:z.literal(1),settings:csvImportOptionsSchema.innerType().omit({columns:true}),columns:fieldLabels}).strict().superRefine((value,ctx)=>{
 const columns=Object.fromEntries(Object.entries(value.columns).filter(([,label])=>label!==undefined).map(([field],index)=>[field,index]));
 if(!csvImportOptionsSchema.safeParse({...value.settings,columns}).success)ctx.addIssue({code:'custom',message:'The saved mapping is incomplete.'});
 const labels=Object.values(value.columns).filter(value=>value!==undefined).map(value=>value!.trim().toLowerCase());
 if(JSON.stringify(value).length>40000)ctx.addIssue({code:'custom',message:'The saved mapping is too large.'});
 if(new Set(labels).size!==labels.length)ctx.addIssue({code:'custom',message:'Saved column names must be distinct.'});
});
export type CSVTemplate=z.infer<typeof csvTemplateSchema>;
export interface SavedCSVTemplate {accountId:string;updatedAt:string;template:CSVTemplate;}
export function createCSVTemplate(csv:string,options?:CSVImportOptions):CSVTemplate|null {
 const header=parseCSV(csv,options?.delimiter)[0];if(!header||header.length>100||header.some(name=>name.length>2000))return null;
 const names=header.map(value=>value.trim().toLowerCase());
 const inferred=Object.fromEntries(CSV_FIELDS.filter(field=>field!=='debit'&&field!=='credit'&&field!=='entity_type').flatMap(field=>{const index=names.indexOf(field==='name'&&!names.includes('name')?'description':field);return index<0?[]:[[field,index]];}));
 const parsed=csvImportOptionsSchema.safeParse(options??{delimiter:',',dateFormat:'ymd',numberFormat:'decimal-dot',amountMode:'signed',signage:'outflows-negative',columns:inferred});
 if(!parsed.success||Object.values(parsed.data.columns).some(index=>index!==undefined&&index>=header.length))return null;
 const {columns,...settings}=parsed.data,mapped=Object.fromEntries(Object.entries(columns).filter(([,index])=>index!==undefined).map(([field,index])=>[field,header[index!]]));
 const result=csvTemplateSchema.safeParse({version:1,settings,columns:mapped});return result.success?result.data:null;
}
export function applyCSVTemplate(csv:string,rawTemplate:CSVTemplate):{header:string[];options:CSVImportOptions}{
 const template=csvTemplateSchema.parse(rawTemplate),header=parseCSV(csv,template.settings.delimiter)[0];
 if(!header||header.length>100)throw new Error('Choose a CSV with between 1 and 100 columns.');
 const names=header.map(value=>value.trim().toLowerCase());if(new Set(names).size!==names.length)throw new Error('CSV headers must be unique before applying a saved mapping.');
 const columns:Partial<Record<CSVField,number>>={};
 for(const [field,name] of Object.entries(template.columns)){if(name===undefined)continue;const index=names.indexOf(name!.trim().toLowerCase());if(index<0)throw new Error(`The saved ${field} column “${name}” is missing. Map this file manually.`);columns[field as CSVField]=index;}
 return {header,options:csvImportOptionsSchema.parse({...template.settings,columns})};
}
