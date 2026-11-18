import {deflateSync} from 'node:zlib';
import {crc32} from '../lib/zip-store.ts';
const join=(parts:Uint8Array[])=>new Uint8Array(Buffer.concat(parts));
export function png(width=1,height=1){const chunk=(type:string,data:Uint8Array)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);b.set(data,8);b.writeUInt32BE((crc32(b.subarray(4,8+data.length))^0xffffffff)>>>0,8+data.length);return b;},header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;return join([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(new Uint8Array([0,20,40,60,255]))),chunk('IEND',new Uint8Array())]);}
export const gif=new Uint8Array(Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==','base64'));
export const webp=new Uint8Array(Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','base64'));
// Minimal marker structure exercises the JPEG container parser; PNG/GIF/WebP
// fixtures above include compressed image payloads.
export const jpeg=new Uint8Array([255,216,255,192,0,11,8,0,1,0,1,1,1,17,0,255,218,0,8,1,1,0,0,63,0,1,255,217]);
