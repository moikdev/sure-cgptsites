import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ApiError} from '../../../lib/repository';
import {readJSON,RequestError} from '../../../lib/http';
import {executeBulkAnnotations} from '../../../lib/bulk-annotations-repository';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
export async function POST(request:Request){try{
 const user=await getChatGPTUser();if(!user)throw new ApiError(401,'Sign in with ChatGPT to continue.');
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'This request must come from this website.');
 if(new URL(request.url).search)throw new ApiError(400,'Send annotation options in the request body.');
 const result=await executeBulkAnnotations(user.userId,await readJSON(request,50000));return result instanceof Response?result:Response.json(result,{headers});
 }catch(e){if(e instanceof ApiError||e instanceof RequestError)return Response.json({error:e.message},{status:e.status,headers});if(e instanceof z.ZodError)return Response.json({error:'Choose 1–100 unique entries, supported fields and a complete current review.'},{status:400,headers});console.error('bulk_annotations_failed');return Response.json({error:'Bulk annotation results could not be confirmed. Reload your workspace before retrying.'},{status:500,headers});}}
