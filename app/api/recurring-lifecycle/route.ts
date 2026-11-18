import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ApiError,readState} from '../../../lib/repository';
import {CURRENCIES,today,validDate} from '../../../lib/finance';
import {recurringLifecycleReport} from '../../../lib/recurring-lifecycle';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
const query=z.object({asOf:z.string().refine(validDate).optional(),offset:z.coerce.number().int().min(0).max(6000).default(0),currency:z.enum(CURRENCIES).optional(),expectedRevision:z.coerce.number().int().safe().nonnegative().optional()}).strict();
export async function GET(request:Request){
 try{
  const user=await getChatGPTUser();if(!user)throw new ApiError(401,'Sign in with ChatGPT to continue.');
  const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>params.getAll(k).length>1))throw new ApiError(400,'Supply each report option once.');
  const parsed=query.safeParse(Object.fromEntries(params));if(!parsed.success)throw new ApiError(400,'Choose a supported report date, currency and page.');
  const q=parsed.data,asOf=q.asOf??today();if(asOf>today())throw new ApiError(400,'Choose a report date through today.');
  const state=await readState(user.userId);if(!state.profile)throw new ApiError(409,'Create your workspace first.');if(q.expectedRevision!==undefined&&q.expectedRevision!==state.profile.revision)throw new ApiError(409,'The workspace changed. Reload the lifecycle report.');
  const report=recurringLifecycleReport(state,asOf,q.offset,q.currency);if(q.offset&&q.offset>=report.total)throw new ApiError(400,'Choose an available notice page.');
  return Response.json(report,{headers});
 }catch(error){if(error instanceof ApiError)return Response.json({error:error.message},{status:error.status,headers});console.error('recurring_lifecycle_report_failed');return Response.json({error:'The recurring lifecycle report could not be loaded.'},{status:500,headers});}
}
