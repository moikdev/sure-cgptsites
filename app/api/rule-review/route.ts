import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ApiError} from '../../../lib/repository';
import {readJSON,RequestError} from '../../../lib/http';
import {ruleScopeSchema} from '../../../lib/rule-schema';
import {reviewRuleRun} from '../../../lib/rule-review-repository';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
const schema=z.object({mode:z.enum(['review','export']),ruleId:z.string().uuid().optional(),scope:ruleScopeSchema.removeDefault().strict().default({}),ignoreLocks:z.boolean().default(false),offset:z.number().int().min(0).max(1999950).multipleOf(50).default(0),expectedRevision:z.number().int().safe().nonnegative().optional(),receipt:z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export async function POST(request:Request){
 try{
  const user=await getChatGPTUser();if(!user)throw new ApiError(401,'Sign in with ChatGPT to continue.');
  const url=new URL(request.url);if(request.headers.get('origin')!==url.origin)throw new ApiError(403,'This request must come from this website.');if(url.search)throw new ApiError(400,'Supply rule-review options in the request body.');
  const parsed=schema.safeParse(await readJSON(request,60000));if(!parsed.success)throw new ApiError(400,'Choose supported rule-review options and a complete page.');
  const c=parsed.data,guard=c.expectedRevision!==undefined&&!!c.receipt;if((c.expectedRevision!==undefined)!==!!c.receipt||((c.offset>0||c.mode==='export')&&!guard)||c.mode==='export'&&c.offset!==0)throw new ApiError(400,'Use one complete current review before paging or exporting.');
  const result=await reviewRuleRun(user.userId,c);return result instanceof Response?result:Response.json(result,{headers});
 }catch(e){if(e instanceof ApiError||e instanceof RequestError)return Response.json({error:e.message},{status:e.status,headers});console.error('rule_review_failed');return Response.json({error:'The complete rule review could not be loaded. Reload and try again.'},{status:500,headers});}
}
