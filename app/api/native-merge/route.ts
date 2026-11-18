import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ApiError} from '../../../lib/repository';
import {readJSON,RequestError} from '../../../lib/http';
import {executeNativeMerge,nativeMergeHistory} from '../../../lib/native-merge-repository';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
function failure(error:unknown){if(error instanceof ApiError||error instanceof RequestError)return Response.json({error:error.message},{status:error.status,headers});if(error instanceof z.ZodError)return Response.json({error:'Choose supported native import options and review every account target.'},{status:400,headers});console.error('native_merge_failed');return Response.json({error:'The native import could not be confirmed. Check this request’s saved status before retrying.'},{status:500,headers});}
async function user(request:Request,write=false){const u=await getChatGPTUser();if(!u)throw new ApiError(401,'Sign in with ChatGPT to continue.');if(write&&request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'This request must come from this website.');return u.userId;}
export async function GET(request:Request){try{const owner=await user(request),params=new URL(request.url).searchParams;if([...params.keys()].some(key=>params.getAll(key).length!==1))throw new ApiError(400,'Supply each native import option once.');const q=z.object({requestId:z.string().uuid().optional()}).strict().parse(Object.fromEntries(params));return Response.json(await nativeMergeHistory(owner,q.requestId),{headers});}catch(error){return failure(error);}}
export async function POST(request:Request){try{return Response.json(await executeNativeMerge(await user(request,true),await readJSON(request,20000000)),{headers});}catch(error){return failure(error);}}
