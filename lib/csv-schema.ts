import {z} from 'zod';
import {CSV_DATE_FORMAT_KEYS} from './csv-date-formats.ts';

export const CSV_FIELDS = ['date','name','amount','debit','credit','entity_type','category','notes','kind','merchant','tags','excluded','currency','account','reconciled_status','investment_activity'] as const;
export type CSVField = typeof CSV_FIELDS[number];
const column = z.number().int().min(0).max(99);
export const csvImportOptionsSchema = z.object({
  delimiter: z.enum([',',';','\t','|']).default(','),
  dateFormat: z.enum(CSV_DATE_FORMAT_KEYS).default('ymd'),
  numberFormat: z.enum(['decimal-dot','decimal-comma','space-comma','integer-comma']).default('decimal-dot'),
  amountMode: z.enum(['signed','split','custom']).default('signed'),
  signage: z.enum(['outflows-negative','outflows-positive']).default('outflows-negative'),
  amountTypeValue:z.string().trim().min(1).max(2000).optional(),
  amountTypeTreatment:z.enum(['inflow','outflow']).optional(),
  columns: z.object({
    date:column,name:column,amount:column.optional(),debit:column.optional(),credit:column.optional(),entity_type:column.optional(),
    category:column.optional(),notes:column.optional(),kind:column.optional(),merchant:column.optional(),tags:column.optional(),
    excluded:column.optional(),currency:column.optional(),account:column.optional(),reconciled_status:column.optional(),investment_activity:column.optional(),
  }).strict(),
}).strict().superRefine((value,ctx)=>{
  const {columns,amountMode}=value;
  if(amountMode==='signed'&&(columns.amount===undefined||columns.debit!==undefined||columns.credit!==undefined))
    ctx.addIssue({code:'custom',message:'Select one signed amount column; leave debit and credit unmapped.'});
  if(amountMode==='split'&&(columns.debit===undefined||columns.credit===undefined||columns.amount!==undefined))
    ctx.addIssue({code:'custom',message:'Select separate debit and credit columns; leave amount unmapped.'});
  if(amountMode==='custom'&&(columns.amount===undefined||columns.entity_type===undefined||columns.debit!==undefined||columns.credit!==undefined||value.amountTypeValue===undefined||value.amountTypeTreatment===undefined))
    ctx.addIssue({code:'custom',message:'Select amount and amount-type columns, one matching type value and its income/expense treatment; leave debit and credit unmapped.'});
  if(amountMode!=='custom'&&(columns.entity_type!==undefined||value.amountTypeValue!==undefined||value.amountTypeTreatment!==undefined))
    ctx.addIssue({code:'custom',message:'Amount-type settings belong to the separate type-column mode.'});
  const selected=Object.values(columns).filter(v=>v!==undefined);
  if(new Set(selected).size!==selected.length)ctx.addIssue({code:'custom',message:'Map each CSV column to one field only.'});
});
export type CSVImportOptions = z.infer<typeof csvImportOptionsSchema>;
