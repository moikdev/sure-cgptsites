import {crc32} from './zip-store.ts';

export const MAX_RECOVERY_ARCHIVE_BYTES=512*1024*1024;
const MAX_ENTRIES=2000,MAX_DIRECTORY_BYTES=2*1024*1024;
export interface ZipEntry {name:string;method:number;flags:number;crc:number;size:number;packedSize:number;offset:number;dataOffset:number;end:number;directory:boolean;}
const invalid=()=>new Error('The ZIP is damaged or uses an unsupported format. Choose an unencrypted, single-volume STORE or DEFLATE archive.');
const view=(bytes:Uint8Array)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
async function bytesAt(blob:Blob,start:number,length:number){if(start<0||length<0||start+length>blob.size)throw invalid();return new Uint8Array(await blob.slice(start,start+length).arrayBuffer());}
function text(bytes:Uint8Array,preserveBOM=false){try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:preserveBOM}).decode(bytes);}catch{throw new Error('ZIP names and text must use UTF-8.');}}
function uint64(v:DataView,p:number){if(p+8>v.byteLength)throw invalid();const value=v.getBigUint64(p,true);if(value>BigInt(Number.MAX_SAFE_INTEGER))throw invalid();return Number(value);}
function extra(bytes:Uint8Array){const v=view(bytes);let zip64:DataView|undefined;for(let p=0;p<bytes.length;){if(p+4>bytes.length)throw invalid();const id=v.getUint16(p,true),length=v.getUint16(p+2,true);if(p+4+length>bytes.length)throw invalid();if(id===1){if(zip64)throw invalid();zip64=view(bytes.subarray(p+4,p+4+length));}p+=4+length;}return zip64;}
function sizes(v:DataView|undefined,size:number,packed:number,offset?:number){let p=0;const next=()=>{if(!v)throw invalid();const n=uint64(v,p);p+=8;return n;};return {size:size===0xffffffff?next():size,packedSize:packed===0xffffffff?next():packed,offset:offset===0xffffffff?next():offset};}
function safeName(name:string){const pieces=name.endsWith('/')?name.slice(0,-1).split('/'):name.split('/');if(!name||name.length>1024||name!==name.normalize('NFC')||/[\\:\u0000-\u001f\u007f-\u009f]/.test(name)||pieces.some(piece=>!piece||piece==='.'||piece==='..'))throw new Error('The ZIP contains an unsafe or ambiguous path.');}

// Random-access Blob slices keep the whole archive out of memory. Every local
// record must agree with its directory entry, including data descriptors.
export async function readZipDirectory(blob:Blob):Promise<ZipEntry[]>{
 if(blob.size>MAX_RECOVERY_ARCHIVE_BYTES)throw new Error('Choose a ZIP no larger than 512 MB.');
 if(blob.size<22)throw invalid();
 const tailStart=Math.max(0,blob.size-65557),tail=await bytesAt(blob,tailStart,blob.size-tailStart),t=view(tail);let end=-1;
 for(let p=tail.length-22;p>=0;p--)if(t.getUint32(p,true)===0x06054b50&&p+22+t.getUint16(p+20,true)===tail.length){end=p;break;}
 if(end<0)throw invalid();let count=t.getUint16(end+10,true),length=t.getUint32(end+12,true),offset=t.getUint32(end+16,true);const absoluteEnd=tailStart+end;let directoryEnd=absoluteEnd;
 if(t.getUint16(end+4,true)!==0||t.getUint16(end+6,true)!==0||t.getUint16(end+8,true)!==count)throw invalid();
 if(absoluteEnd>=20){const locator=view(await bytesAt(blob,absoluteEnd-20,20));if(locator.getUint32(0,true)===0x07064b50){
  if(locator.getUint32(4,true)!==0||locator.getUint32(16,true)!==1)throw invalid();const at=uint64(locator,8),record=view(await bytesAt(blob,at,56)),recordSize=uint64(record,4);
  if(record.getUint32(0,true)!==0x06064b50||recordSize<44||recordSize>4096||at+12+recordSize!==absoluteEnd-20||record.getUint32(16,true)!==0||record.getUint32(20,true)!==0||uint64(record,24)!==uint64(record,32))throw invalid();
  const fullCount=uint64(record,32),fullLength=uint64(record,40),fullOffset=uint64(record,48);
  if(count!==0xffff&&count!==fullCount||length!==0xffffffff&&length!==fullLength||offset!==0xffffffff&&offset!==fullOffset)throw invalid();count=fullCount;length=fullLength;offset=fullOffset;directoryEnd=at;
 }}
 if(count<1||count>MAX_ENTRIES||length>MAX_DIRECTORY_BYTES||offset+length!==directoryEnd)throw invalid();
 const bytes=await bytesAt(blob,offset,length),v=view(bytes),entries:ZipEntry[]=[],names=new Set<string>();let p=0,total=0;
 for(let i=0;i<count;i++){
  if(p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw invalid();
  const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),nameLength=v.getUint16(p+28,true),extraLength=v.getUint16(p+30,true),commentLength=v.getUint16(p+32,true),finish=p+46+nameLength+extraLength+commentLength;
  if(flags&~0x080e||![0,8].includes(method)||v.getUint16(p+34,true)!==0||finish>bytes.length)throw invalid();
  const name=text(bytes.subarray(p+46,p+46+nameLength),true);safeName(name);if(names.has(name))throw new Error('The ZIP contains duplicate paths.');names.add(name);const unpacked=sizes(extra(bytes.subarray(p+46+nameLength,p+46+nameLength+extraLength)),v.getUint32(p+24,true),v.getUint32(p+20,true),v.getUint32(p+42,true)),{size,packedSize}=unpacked,local=unpacked.offset!;
  const directory=name.endsWith('/'),unixType=(v.getUint32(p+38,true)>>>16)&0xf000;
  if(unixType&&unixType!==(directory?0x4000:0x8000)||directory&&(size!==0||packedSize!==0||crc!==0)||method===0&&packedSize!==size)throw invalid();
  total+=size;if(total>MAX_RECOVERY_ARCHIVE_BYTES)throw new Error('The ZIP expands beyond the 512 MB limit.');
  entries.push({name,method,flags,crc,size,packedSize,offset:local,dataOffset:0,end:0,directory});p=finish;
 }
 if(p!==bytes.length)throw invalid();
 for(const entry of entries){
  const header=await bytesAt(blob,entry.offset,30),h=view(header);
  if(h.getUint32(0,true)!==0x04034b50||h.getUint16(6,true)!==entry.flags||h.getUint16(8,true)!==entry.method)throw invalid();
  const nameLength=h.getUint16(26,true),extraLength=h.getUint16(28,true),names=await bytesAt(blob,entry.offset+30,nameLength+extraLength);
  if(text(names.subarray(0,nameLength),true)!==entry.name)throw invalid();const localSizes=sizes(extra(names.subarray(nameLength)),h.getUint32(22,true),h.getUint32(18,true));entry.dataOffset=entry.offset+30+nameLength+extraLength;entry.end=entry.dataOffset+entry.packedSize;
  if(entry.end>offset)throw invalid();
  if(entry.flags&8){
   const wide=h.getUint32(18,true)===0xffffffff||h.getUint32(22,true)===0xffffffff,descriptor=await bytesAt(blob,entry.end,Math.min(wide?24:16,offset-entry.end)),d=view(descriptor),start=descriptor.length>=4&&d.getUint32(0,true)===0x08074b50?4:0,body=wide?20:12;
   if(descriptor.length<start+body||d.getUint32(start,true)!==entry.crc||(wide?uint64(d,start+4):d.getUint32(start+4,true))!==entry.packedSize||(wide?uint64(d,start+12):d.getUint32(start+8,true))!==entry.size)throw invalid();entry.end+=start+body;
  }else if(h.getUint32(14,true)!==entry.crc||localSizes.packedSize!==entry.packedSize||localSizes.size!==entry.size)throw invalid();

 }
 const ordered=[...entries].sort((a,b)=>a.offset-b.offset);let next=0;for(const entry of ordered){if(entry.offset!==next)throw invalid();next=entry.end;}if(next!==offset)throw invalid();
 return entries;
}

export async function* readZipChunks(blob:Blob,entry:ZipEntry,maxBytes:number,signal?:AbortSignal):AsyncGenerator<Uint8Array>{
 if(entry.directory||entry.size>maxBytes)throw new Error(`Archive entry ${entry.name} exceeds its supported size.`);
 signal?.throwIfAborted();let position=entry.dataOffset;let stream:ReadableStream<Uint8Array>=new ReadableStream({async pull(controller){const size=Math.min(16384,entry.dataOffset+entry.packedSize-position);if(!size){controller.close();return;}const bytes=await bytesAt(blob,position,size);position+=size;controller.enqueue(bytes);}});
 if(entry.method===8){try{stream=stream.pipeThrough(new DecompressionStream('deflate-raw') as unknown as ReadableWritablePair<Uint8Array,Uint8Array>);}catch{throw new Error('This browser cannot read compressed ZIP files. Extract the archive locally and select its JSON or NDJSON file.');}}
 const reader=stream.getReader();let count=0,checksum=0xffffffff;
 const abort=()=>{void reader.cancel(signal?.reason);};signal?.addEventListener('abort',abort,{once:true});
 try{while(true){signal?.throwIfAborted();const part=await reader.read();if(part.done)break;count+=part.value.length;if(count>entry.size||count>maxBytes)throw new Error(`Archive entry ${entry.name} expands beyond its declared size.`);checksum=crc32(part.value,checksum);yield part.value;}
  signal?.throwIfAborted();if(count!==entry.size||((checksum^0xffffffff)>>>0)!==entry.crc)throw new Error(`Archive entry ${entry.name} failed its size or CRC check.`);

 }finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});}
}
export async function readZipEntry(blob:Blob,entry:ZipEntry,maxBytes:number,signal?:AbortSignal):Promise<Uint8Array>{const chunks:Uint8Array[]=[];let count=0;for await(const chunk of readZipChunks(blob,entry,maxBytes,signal)){chunks.push(chunk);count+=chunk.length;}const output=new Uint8Array(count);let offset=0;for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.length;}return output;}
export async function readZipText(blob:Blob,entry:ZipEntry,maxBytes:number,signal?:AbortSignal){return text(await readZipEntry(blob,entry,maxBytes,signal));}
