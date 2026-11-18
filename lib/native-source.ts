import {z} from 'zod';import {readBackupArchive} from './backup-archive.ts';import {MAX_IMPORT_BYTES} from './workspace.ts';import {validDate,today,CURRENCIES} from './finance.ts';import {nativeAccountTargetsSchema,type NativeAccountTargets} from './native-merge.ts';
export const NATIVE_SOURCE_BYTES=MAX_IMPORT_BYTES;
export const nativeSourceOptionsSchema=z.object({exportDate:z.string().refine(v=>validDate(v)&&v<=today(),'Choose an export date no later than today.'),useInvestmentRates:z.boolean().default(false),ruleCurrency:z.enum(CURRENCIES).optional()}).strict();
export type NativeSourceOptions=z.infer<typeof nativeSourceOptionsSchema>;
export function nativeSourceRequestId(row:{requestId:string;activeRequestId?:string|null}){return row.activeRequestId??row.requestId;}
export const nativeSourceFilenameSchema=z.string().trim().min(1).max(180).refine(v=>!/[\\/\u0000-\u001f\u007f-\u009f]/.test(v)&&!Array.from(v).some(c=>c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff)&&/\.(zip|ndjson|jsonl)$/i.test(v),'Use a ZIP, NDJSON or JSONL filename without path separators.');
export function canonicalNativeTargets(input:NativeAccountTargets){return [...nativeAccountTargetsSchema.parse(input)].sort((a,b)=>a.sourceId<b.sourceId?-1:a.sourceId>b.sourceId?1:0);}
export async function nativeSourceText(bytes:Uint8Array,kind:'ndjson'|'zip'){
 if(!bytes.length||bytes.length>NATIVE_SOURCE_BYTES)throw new Error('Choose a native source between 1 byte and 8 MB.');
 let content:string;if(kind==='zip')content=(await readBackupArchive(new Blob([new Uint8Array(bytes)]),'sure')).content;else{try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error('Choose UTF-8 NDJSON text.');}}
 if(!content.trim()||content.includes('\0')||new TextEncoder().encode(content).length>MAX_IMPORT_BYTES)throw new Error('Choose UTF-8 native export data no larger than 8 MB, without NUL bytes.');return content;
}
