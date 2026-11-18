import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ApiError,readState} from '../../../lib/repository';
import {CURRENCIES,today,validDate} from '../../../lib/finance';
import {BILL_STATUSES,BILL_TYPES,BILL_SECTIONS,billPage,billsOverviewPage,billsCalendarPage,billsCalendarAgendaPage,createBillsOverview,createBillsCalendar,createBillSchedules,billsICalendar} from '../../../lib/bills-workspace';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'};
const schema=z.object({view:z.enum(['overview','calendar','agenda','schedules','ics']).default('overview'),asOf:z.string().refine(validDate).optional(),currency:z.enum(CURRENCIES).optional(),month:z.string().regex(/^\d{4}-\d{2}$/).optional(),day:z.string().refine(validDate).optional(),section:z.enum(BILL_SECTIONS).optional(),status:z.enum(BILL_STATUSES).optional(),type:z.enum(BILL_TYPES).optional(),search:z.string().max(160).optional(),sort:z.enum(['status','name','amount']).optional(),offset:z.coerce.number().int().min(0).max(20000).default(0),expectedRevision:z.coerce.number().int().safe().nonnegative().optional()}).strict();
export async function GET(request:Request){
 try{
  const user=await getChatGPTUser();if(!user)throw new ApiError(401,'Sign in with ChatGPT to continue.');
  const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>params.getAll(k).length>1))throw new ApiError(400,'Supply each bills option once.');
  const result=schema.safeParse(Object.fromEntries(params));if(!result.success)throw new ApiError(400,'Choose supported bills options.');const q=result.data,asOf=q.asOf??today();
  if(asOf>today())throw new ApiError(400,'Choose a reporting date through today.');
  const incompatible=!['calendar','agenda'].includes(q.view)&&q.month!==undefined||q.view!=='calendar'&&q.day!==undefined||q.view!=='overview'&&q.section!==undefined||q.view!=='schedules'&&[q.status,q.type,q.search,q.sort].some(v=>v!==undefined)||q.view==='ics'&&(q.offset!==0||q.currency!==undefined);
  if(incompatible)throw new ApiError(400,'Choose options for the requested bills view.');
  const state=await readState(user.userId);if(!state.profile)throw new ApiError(409,'Create your workspace first.');
  if(q.expectedRevision!==undefined&&q.expectedRevision!==state.profile.revision)throw new ApiError(409,'The workspace changed. Reload bills before continuing.');
  const options={asOf,currency:q.currency??state.profile.currency};
  try{
   if(q.view==='ics')return new Response(billsICalendar(state,asOf),{headers:{...headers,'Content-Type':'text/calendar;charset=utf-8','Content-Disposition':'attachment; filename="sure-upcoming-bills.ics"'}});
   let data;
   if(q.view==='agenda'){const calendar=createBillsCalendar(state,{...options,month:q.month});data={asOf:calendar.asOf,currency:calendar.currency,revision:calendar.revision,month:calendar.month,limit:calendar.limit,count:calendar.count,expected:calendar.expected,paid:calendar.paid,page:billsCalendarAgendaPage(calendar,q.offset)};}
   else if(q.view==='calendar')data=billsCalendarPage(createBillsCalendar(state,{...options,month:q.month}),q.day,q.offset);
   else if(q.view==='schedules'){const {rows,...summary}=createBillSchedules(state,{...options,status:q.status,type:q.type,search:q.search,sort:q.sort});data={...summary,page:billPage(rows,q.offset)};}
   else data=billsOverviewPage(createBillsOverview(state,options),q.section,q.offset);
   return Response.json(data,{headers});
  }catch(error){throw new ApiError(400,error instanceof Error?error.message:'Bills could not be calculated.');}
 }catch(error){if(error instanceof ApiError)return Response.json({error:error.message},{status:error.status,headers});console.error('bills_workspace_failed');return Response.json({error:'Bills could not be loaded.'},{status:500,headers});}
}
