import {z} from 'zod';
import {QIF_BYTES,decodeQIF} from './qif-parser.ts';
export {QIF_BYTES};
export const qifFilenameSchema=z.string().trim().min(1).max(180).refine(v=>!/[\\/\u0000-\u001f\u007f-\u009f]/.test(v)&&!Array.from(v).some(c=>c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff)&&/\.qif$/i.test(v),'Use a QIF filename without path separators.');
export const qifReserveSchema=z.object({requestId:z.string().uuid(),filename:qifFilenameSchema,byteSize:z.number().int().min(1).max(QIF_BYTES),sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export function qifOriginalText(bytes:Uint8Array){return decodeQIF(bytes);}
export const qifRequestId=(source:{requestId:string;activeRequestId:string|null})=>source.activeRequestId??source.requestId;
