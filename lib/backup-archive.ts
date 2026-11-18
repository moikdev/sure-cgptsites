import {z} from 'zod';
import {statementFileFields} from './statement-file-schema.ts';
import {sha256,validateStatementBytes,MAX_STATEMENT_FILE_BYTES,MAX_FILE_ARCHIVE_BYTES} from './file-validation.ts';
import {MAX_IMPORT_BYTES} from './workspace.ts';
import {readZipDirectory,readZipEntry,readZipText,type ZipEntry} from './zip-read.ts';

const fileSchema=z.object({id:z.string().min(1).max(160),...statementFileFields});
export type ArchiveFile=z.infer<typeof fileSchema>;
export interface ArchiveOriginal {entry:ZipEntry;file:ArchiveFile;}
export interface BackupArchive {sourceFormat:'sites'|'sure';content:string;originals:ArchiveOriginal[];unavailable:number;totalBytes:number;}
export interface ArchiveProgress {stage:'reading'|'checking'|'uploading';completed:number;total:number;filename?:string;}
const decodeJSON=(content:string)=>{try{return JSON.parse(content);}catch{throw new Error('The archive contains invalid JSON.');}};
const one=(entries:ZipEntry[],name:string)=>{const found=entries.filter(entry=>!entry.directory&&(entry.name===name||entry.name.endsWith('/'+name)));if(found.length!==1)throw new Error(`Choose a ZIP containing exactly one ${name}.`);return found[0];};
export async function archiveOriginalBytes(blob:Blob,original:ArchiveOriginal,signal?:AbortSignal){
 const bytes=await readZipEntry(blob,original.entry,MAX_STATEMENT_FILE_BYTES,signal);
 validateStatementBytes(original.file.filename,original.file.contentType,bytes);
 if(bytes.length!==original.file.byteSize||await sha256(bytes)!==original.file.sha256)throw new Error(`Original ${original.file.filename} does not match its backup checksum.`);
 signal?.throwIfAborted();return bytes;
}
export async function readBackupArchive(blob:Blob,sourceFormat:'sites'|'sure',progress?:(value:ArchiveProgress)=>void,signal?:AbortSignal):Promise<BackupArchive>{
 signal?.throwIfAborted();progress?.({stage:'reading',completed:0,total:0});const entries=await readZipDirectory(blob);signal?.throwIfAborted();
 const financial=one(entries,sourceFormat==='sites'?'finance-data.json':'all.ndjson'),prefix=financial.name.slice(0,-(sourceFormat==='sites'?'finance-data.json':'all.ndjson').length),content=await readZipText(blob,financial,MAX_IMPORT_BYTES,signal);
 if(sourceFormat==='sure'){
  const marker=entries.find(e=>e.name===prefix+'version.txt'&&!e.directory);if(!marker||!/^export_version:\s*2\s*$/.test(await readZipText(blob,marker,1024,signal)))throw new Error('This ZIP is not a Sure export v2. Its version.txt must say export_version: 2.');
  return {sourceFormat,content,originals:[],unavailable:0,totalBytes:0};
 }
 const backup=decodeJSON(content);if(backup?.format!=='sure-sites')throw new Error('The ZIP finance-data.json is not a Sure Sites backup.');
 const incoming=z.array(fileSchema).max(500).parse(backup.statementFiles??[]),manifestEntry=entries.find(e=>e.name===prefix+'manifest.json'&&!e.directory);
 if(!manifestEntry)throw new Error('The ZIP is missing manifest.json.');
 const manifest=z.object({format:z.literal('sure-sites-files'),version:z.literal(1),files:z.array(fileSchema.extend({path:z.string().max(1024).nullable()})).max(500)}).parse(decodeJSON(await readZipText(blob,manifestEntry,2*1024*1024,signal)));
 if(incoming.length!==manifest.files.length||new Set(incoming.map(f=>f.id)).size!==incoming.length||new Set(incoming.map(f=>f.sha256)).size!==incoming.length||new Set(manifest.files.map(f=>f.id)).size!==manifest.files.length)throw new Error('The ZIP manifest and finance file have different or duplicate original records.');
 const allowed=new Set([financial.name,manifestEntry.name]),originals:ArchiveOriginal[]=[];let unavailable=0,totalBytes=0;
 for(const file of incoming){
  const item=manifest.files.find(item=>item.id===file.id);if(!item||JSON.stringify(fileSchema.parse(item))!==JSON.stringify(file))throw new Error('The ZIP manifest does not match its financial file metadata.');
  if(file.uploadStatus!=='ready'){if(item.path!==null)throw new Error('An unavailable original has an unexpected ZIP path.');unavailable++;continue;}
  const path=`statement-files/${file.id}/${file.filename}`;if(item.path!==path)throw new Error('An original has an unexpected ZIP path.');
  const entry=entries.find(e=>e.name===prefix+path&&!e.directory);if(!entry||entry.size!==file.byteSize)throw new Error(`The ZIP is missing or has an incomplete original: ${file.filename}.`);
  allowed.add(entry.name);originals.push({entry,file});totalBytes+=file.byteSize;
 }
 if(totalBytes>MAX_FILE_ARCHIVE_BYTES)throw new Error('Originals exceed the 500 MB archive limit.');
 for(const entry of entries)if(!entry.directory&&!allowed.has(entry.name))throw new Error('The Sites ZIP contains an unrecognized file. Keep the original backup unchanged.');
 for(let index=0;index<originals.length;index++){signal?.throwIfAborted();progress?.({stage:'checking',completed:index,total:originals.length,filename:originals[index].file.filename});await archiveOriginalBytes(blob,originals[index],signal);}
 progress?.({stage:'checking',completed:originals.length,total:originals.length});return {sourceFormat,content,originals,unavailable,totalBytes};
}

// Each upload is independently checked against an already-restored owner record.
// A retry reuses the checksums, not old record IDs or a financial replacement.
export async function restoreArchiveOriginals(blob:Blob,archive:BackupArchive,upload:(original:ArchiveOriginal,bytes:Uint8Array)=>Promise<void>,progress?:(value:ArchiveProgress)=>void,signal?:AbortSignal,isAvailable?:(original:ArchiveOriginal)=>Promise<boolean>){
 let completed=0;
 for(const original of archive.originals){signal?.throwIfAborted();progress?.({stage:'uploading',completed,total:archive.originals.length,filename:original.file.filename});if(!await isAvailable?.(original)){const bytes=await archiveOriginalBytes(blob,original,signal);await upload(original,bytes);}completed++;}
 progress?.({stage:'uploading',completed,total:archive.originals.length});return completed;
}
