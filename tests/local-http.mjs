import http from 'node:http';import {Readable} from 'node:stream';
// Keep rejected-body requests off Undici's reusable local-proxy connections.
// Preserve streamed response bytes and all assertions; never retry a request.
export function localFetch(input,init={}){
  const url=new URL(input);if(url.origin!=='http://127.0.0.1:8799')throw new Error('Integration requests must use the loopback test Worker.');
  const direct=globalThis[Symbol.for('sure-sites.direct-test-fetch')];if(direct)return direct(url,init);
  const body=init.body===undefined?undefined:typeof init.body==='string'?Buffer.from(init.body):ArrayBuffer.isView(init.body)?Buffer.from(init.body.buffer,init.body.byteOffset,init.body.byteLength):null;if(body===null)throw new TypeError('Choose a string or typed-array integration body.');
  const headers=new Headers(init.headers);headers.set('connection','close');headers.set('accept-encoding','identity');if(body!==undefined)headers.set('content-length',String(body.length));
  return new Promise((resolve,reject)=>{const req=http.request(url,{agent:false,method:init.method??'GET',headers:Object.fromEntries(headers),signal:init.signal},res=>{const responseHeaders=new Headers();for(let i=0;i<res.rawHeaders.length;i+=2)responseHeaders.append(res.rawHeaders[i],res.rawHeaders[i+1]);const noBody=init.method==='HEAD'||[204,205,304].includes(res.statusCode);if(noBody)res.resume();resolve(new Response(noBody?null:Readable.toWeb(res),{status:res.statusCode,statusText:res.statusMessage,headers:responseHeaders}));});req.on('error',reject);req.end(body);});
}
