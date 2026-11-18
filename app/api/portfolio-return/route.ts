import {z} from 'zod';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ApiError,readState} from '../../../lib/repository';
import {CURRENCIES,validDate} from '../../../lib/finance';
import {createPortfolioReturnReport,portfolioReturnPage,portfolioReturnCSV} from '../../../lib/portfolio-return';
export const dynamic='force-dynamic';
const page=z.coerce.number().int().min(0).max(40000).multipleOf(25).default(0),headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'},schema=z.object({currency:z.enum(CURRENCIES),from:z.string().refine(validDate),to:z.string().refine(validDate),accountId:z.string().uuid().optional(),offset:page,accountOffset:page,issueOffset:page,quoteOffset:page,format:z.enum(['json','csv']).default('json'),expectedRevision:z.coerce.number().int().safe().nonnegative().optional()}).strict();
export async function GET(request:Request){try{
 const user=await getChatGPTUser();if(!user)throw new ApiError(401,'Sign in with ChatGPT to continue.');
 const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>params.getAll(k).length!==1))throw new ApiError(400,'Supply each return option once.');
 const parsed=schema.safeParse(Object.fromEntries(params));if(!parsed.success)throw new ApiError(400,'Choose supported return dates, scope and review pages.');const c=parsed.data;
 if(c.format==='csv'&&[c.offset,c.accountOffset,c.issueOffset,c.quoteOffset].some(n=>n!==0))throw new ApiError(400,'Export the complete return report without page offsets.');
 const state=await readState(user.userId);if(!state.profile)throw new ApiError(409,'Create your workspace first.');
 if(c.expectedRevision!==undefined&&c.expectedRevision!==state.profile.revision)throw new ApiError(409,'The workspace changed. Reload the complete return report.');
 if(c.accountId&&!state.accounts.some(a=>a.id===c.accountId&&a.currency===c.currency&&['investment','crypto'].includes(a.type)))throw new ApiError(404,'Investment account not found in this currency.');
 let report;try{report=createPortfolioReturnReport(state,{currency:c.currency,from:c.from,to:c.to,...(c.accountId?{accountId:c.accountId}:{})});}catch(e){throw new ApiError(400,(e as Error).message);}
 if(c.format==='csv')return new Response(portfolioReturnCSV(report),{headers:{...headers,'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="sure-money-weighted-return.csv"'}});
 return Response.json(portfolioReturnPage(report,c.offset,c.accountOffset,c.issueOffset,c.quoteOffset),{headers});
 }catch(e){if(e instanceof ApiError)return Response.json({error:e.message},{status:e.status,headers});console.error('portfolio_return_failed');return Response.json({error:'Money-weighted return could not be loaded.'},{status:500,headers});}}
