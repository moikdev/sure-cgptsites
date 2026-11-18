import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ApiError,readState} from '../../../lib/repository';
import {CURRENCIES,validDate} from '../../../lib/finance';
import {createPortfolioPerformanceReport,portfolioPerformancePage,portfolioPerformanceCSV} from '../../../lib/portfolio-performance';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'},schema=z.object({currency:z.enum(CURRENCIES),from:z.string().refine(validDate),to:z.string().refine(validDate),accountId:z.string().uuid().optional(),offset:z.coerce.number().int().min(0).max(40000).default(0),format:z.enum(['json','csv']).default('json'),expectedRevision:z.coerce.number().int().nonnegative().safe().optional()}).strict();
export async function GET(request:Request){try{
 const user=await getChatGPTUser();if(!user)throw new ApiError(401,'Sign in with ChatGPT to continue.');
 const params=new URL(request.url).searchParams;if([...params.keys()].some(key=>params.getAll(key).length>1))throw new ApiError(400,'Supply each performance option once.');
 const parsed=schema.safeParse(Object.fromEntries(params));if(!parsed.success)throw new ApiError(400,'Choose supported portfolio performance options.');const c=parsed.data;
 if(c.format==='csv'&&c.offset!==0)throw new ApiError(400,'Export the complete performance report without a page offset.');
 const state=await readState(user.userId);if(!state.profile)throw new ApiError(409,'Create your workspace first.');
 if(c.expectedRevision!==undefined&&c.expectedRevision!==state.profile.revision)throw new ApiError(409,'The workspace changed. Reload the performance report.');
 if(c.accountId&&!state.accounts.some(a=>a.id===c.accountId&&['investment','crypto'].includes(a.type)&&a.currency===c.currency))throw new ApiError(404,'Investment account not found in this currency.');
 let report;try{report=createPortfolioPerformanceReport(state,{currency:c.currency,from:c.from,to:c.to,...(c.accountId?{accountId:c.accountId}:{})});}catch(error){throw new ApiError(400,(error as Error).message);}
 if(c.format==='csv')return new Response(portfolioPerformanceCSV(report),{headers:{...headers,'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="sure-portfolio-performance.csv"'}});
 return Response.json(portfolioPerformancePage(report,c.offset),{headers});
 }catch(error){if(error instanceof ApiError)return Response.json({error:error.message},{status:error.status,headers});console.error('portfolio_performance_failed');return Response.json({error:'Portfolio performance could not be loaded.'},{status:500,headers});}}
