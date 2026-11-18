import {crc32} from './zip-store.ts';

// Parse container boundaries and dimensions without decoding untrusted raster data.
export function inspectReceiptImage(type:string,bytes:Uint8Array){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),ascii=(p:number,n:number)=>String.fromCharCode(...bytes.subarray(p,p+n));
 const invalid=()=>{throw new Error('The image is truncated or has an unsupported structure.');};
 const dimensions=(width:number,height:number)=>{if(!width||!height||width>16384||height>16384||width*height>40000000)throw new Error('Images must be at most 16,384 pixels per side and 40 megapixels.');return {width,height};};
 if(type==='image/png'){
  if(bytes.length<45||ascii(0,8)!=='\x89PNG\r\n\x1a\n')return invalid();let p=8,header=false,data=false,result={width:0,height:0};
  while(p+12<=bytes.length){const length=view.getUint32(p),kind=ascii(p+4,4),end=p+12+length;if(end>bytes.length)return invalid();if(((crc32(bytes.subarray(p+4,p+8+length))^0xffffffff)>>>0)!==view.getUint32(p+8+length))return invalid();if(!header){if(kind!=='IHDR'||length!==13)return invalid();result=dimensions(view.getUint32(p+8),view.getUint32(p+12));header=true;}else if(kind==='IHDR')return invalid();if(kind==='IDAT'&&length)data=true;if(kind==='IEND'){if(length||!data||end!==bytes.length)return invalid();return result;}p=end;}return invalid();
 }
 if(type==='image/jpeg'){
  if(bytes.length<4||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)return invalid();let p=2,result:{width:number;height:number}|null=null;
  while(p<bytes.length-2){if(bytes[p++]!==255)return invalid();while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===217)break;if(marker===0||marker===216)return invalid();if(marker>=208&&marker<=215||marker===1)continue;if(p+2>bytes.length)return invalid();const length=view.getUint16(p);if(length<2||p+length>bytes.length-2)return invalid();if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(length<8)return invalid();result=dimensions(view.getUint16(p+5),view.getUint16(p+3));}if(marker===218){if(!result||length<6)return invalid();return result;}p+=length;}return invalid();
 }
 if(type==='image/gif'){
  if(bytes.length<14||!['GIF87a','GIF89a'].includes(ascii(0,6)))return invalid();const result=dimensions(view.getUint16(6,true),view.getUint16(8,true));let p=13+((bytes[10]&128)?3*(1<<((bytes[10]&7)+1)):0),frames=0;
  const blocks=()=>{while(p<bytes.length){const n=bytes[p++];if(!n)return;p+=n;if(p>bytes.length)return invalid();}return invalid();};
  while(p<bytes.length){const marker=bytes[p++];if(marker===59){if(!frames||p!==bytes.length)return invalid();return result;}if(marker===33){if(p>=bytes.length)return invalid();p++;blocks();}else if(marker===44){if(p+9>=bytes.length)return invalid();const x=view.getUint16(p,true),y=view.getUint16(p+2,true),w=view.getUint16(p+4,true),h=view.getUint16(p+6,true),flags=bytes[p+8];dimensions(w,h);if(x+w>result.width||y+h>result.height)return invalid();p+=9;if(flags&128)p+=3*(1<<((flags&7)+1));if(p>=bytes.length||bytes[p]<2||bytes[p]>8)return invalid();p++;blocks();frames++;}else return invalid();}return invalid();
 }
 if(type==='image/webp'){
  if(bytes.length<20||ascii(0,4)!=='RIFF'||ascii(8,4)!=='WEBP'||view.getUint32(4,true)+8!==bytes.length)return invalid();let p=12,result:{width:number;height:number}|null=null,image=false;
  while(p+8<=bytes.length){const kind=ascii(p,4),length=view.getUint32(p+4,true),start=p+8,end=start+length;if(end>bytes.length)return invalid();if(kind==='VP8X'){if(length!==10)return invalid();const width=1+bytes[start+4]+(bytes[start+5]<<8)+(bytes[start+6]<<16),height=1+bytes[start+7]+(bytes[start+8]<<8)+(bytes[start+9]<<16);result=dimensions(width,height);}else if(kind==='VP8 '){if(length<10||ascii(start+3,3)!=='\x9d\x01\x2a')return invalid();const dim=dimensions(view.getUint16(start+6,true)&16383,view.getUint16(start+8,true)&16383);result??=dim;image=true;}else if(kind==='VP8L'){if(length<5||bytes[start]!==47)return invalid();const bits=view.getUint32(start+1,true);result??=dimensions(1+(bits&16383),1+((bits>>>14)&16383));image=true;}else if(kind==='ANMF'){if(length<24||!result)return invalid();image=true;}p=end+(length%2);}if(p!==bytes.length||!result||!image)return invalid();return result;
 }
 return invalid();
}
