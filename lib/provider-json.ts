/** Preserve numeric JSON lexemes. A runtime without source context fails closed. */
export function parseExactProviderJSON(text:string,label='Provider'):unknown{
 let depth=0,string=false,escaped=false;
 for(const c of text){if(string){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')string=false;}else if(c==='"')string=true;else if(c==='{'||c==='['){if(++depth>16)throw Error(label+' JSON is too deeply nested.');}else if(c==='}'||c===']')depth--;}
 return JSON.parse(text.replace(/^\uFEFF/,''),(_key:string,value:unknown,context?:{source?:string})=>{if(typeof value!=='number')return value;if(typeof context?.source!=='string')throw Error('This runtime cannot preserve provider decimal tokens.');return context.source;});
}
