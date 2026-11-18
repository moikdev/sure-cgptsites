import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ApiError} from '../../../lib/repository';
import {readJSON,RequestError} from '../../../lib/http';
import {executeBudgetCopy} from '../../../lib/budget-copy-repository';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
export async function POST(request:Request){try{
 const user=await getChatGPTUser();if(!user)throw new ApiError(401,'Sign in with ChatGPT to continue.');
 if(request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'This request must come from this website.');
 return Response.json(await executeBudgetCopy(user.userId,await readJSON(request,16000)),{headers});
 }catch(e){if(e instanceof ApiError||e instanceof RequestError)return Response.json({error:e.message},{status:e.status,headers});if(e instanceof z.ZodError)return Response.json({error:'Choose two budget periods, a conversion date, a supported review page and the exact confirmation.'},{status:400,headers});console.error('budget_copy_operation_failed');return Response.json({error:'The copy could not be confirmed. Reload budgets and review again.'},{status:500,headers});}}
