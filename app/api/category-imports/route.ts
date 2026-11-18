import {z} from 'zod';
import {validDate} from '../../../lib/finance';
import {getChatGPTUser} from '../../chatgpt-auth';
import {ApiError} from '../../../lib/repository';
import {readJSON,RequestError} from '../../../lib/http';
import {FileInputError} from '../../../lib/file-validation';
import {reserveCategoryCSVSchema,listCategoryCSVs,reserveCategoryCSV,uploadCategoryCSV,recoverCategoryCSV,categorySource,exportCategories,reviewCategoryCSV,commitCategoryCSV,previewCategoryCSVRevert,revertCategoryCSV,deleteCategoryCSV} from '../../../lib/category-csv-repository';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'},id=z.string().uuid();
const querySchema=z.object({id:id.optional(),offset:z.coerce.number().int().min(0).max(9975).multipleOf(25).default(0),changeOffset:z.coerce.number().int().min(0).max(1975).multipleOf(25).default(0),budgetOffset:z.coerce.number().int().min(0).max(20225).multipleOf(25).default(0),format:z.enum(['json','csv','categories']).default('json')}).strict();
const commit=z.object({id,expectedRevision:z.number().int().safe().nonnegative(),receipt:z.string().regex(/^[a-f0-9]{64}$/)});
const command=z.discriminatedUnion('action',[
  reserveCategoryCSVSchema.extend({action:z.literal('reserve')}),
  commit.extend({action:z.literal('commit'),reviewedOn:z.string().refine(validDate)}).strict(),
  commit.extend({action:z.literal('revertCommit'),confirmation:z.literal('REVERT')}).strict(),
  z.object({action:z.literal('recover'),id}).strict(),
  z.object({action:z.literal('delete'),id}).strict(),
  z.object({action:z.literal('revertPreview'),id}).strict(),
]);
async function user(request:Request,write=false){const user=await getChatGPTUser();if(!user)throw new ApiError(401,'Sign in with ChatGPT to continue.');if(write&&request.headers.get('origin')!==new URL(request.url).origin)throw new ApiError(403,'This request must come from this website.');return user.userId;}
function failure(error:unknown){if(error instanceof ApiError||error instanceof RequestError||error instanceof FileInputError)return Response.json({error:error.message},{status:error.status,headers});if(error instanceof z.ZodError)return Response.json({error:'Choose supported category import options.'},{status:400,headers});console.error('category_csv_operation_failed');return Response.json({error:'The category import operation could not complete. Reopen its saved status before retrying.'},{status:500,headers});}
function query(request:Request){const p=new URL(request.url).searchParams;if([...p.keys()].some(k=>p.getAll(k).length!==1))throw new ApiError(400,'Supply each category import option once.');return querySchema.parse(Object.fromEntries(p));}
export async function GET(request:Request){try{const owner=await user(request),c=query(request);if(c.format==='categories'){if(c.id||c.offset||c.changeOffset||c.budgetOffset)throw new ApiError(400,'Export all categories without an import or offset.');return await exportCategories(owner);}if(c.format==='csv'){if(!c.id||c.offset||c.changeOffset||c.budgetOffset)throw new ApiError(400,'Download one original source without an offset.');return await categorySource(owner,c.id);}if(!c.id&&(c.offset||c.changeOffset||c.budgetOffset))throw new ApiError(400,'Select a category import before paging.');return Response.json(c.id?await reviewCategoryCSV(owner,c.id,c.offset,c.changeOffset,c.budgetOffset):await listCategoryCSVs(owner),{headers});}catch(error){return failure(error);}}
export async function POST(request:Request){try{const owner=await user(request,true),c=command.parse(await readJSON(request,12000));let result;if(c.action==='reserve'){const {action,...input}=c;result=await reserveCategoryCSV(owner,input);}else if(c.action==='commit')result=await commitCategoryCSV(owner,c.id,c);else if(c.action==='recover')result=await recoverCategoryCSV(owner,c.id);else if(c.action==='delete')result=await deleteCategoryCSV(owner,c.id);else if(c.action==='revertPreview')result=await previewCategoryCSVRevert(owner,c.id);else result=await revertCategoryCSV(owner,c.id,c);return Response.json(result,{headers});}catch(error){return failure(error);}}
export async function PUT(request:Request){try{const owner=await user(request,true),c=query(request);if(!c.id||c.offset||c.changeOffset||c.budgetOffset||c.format!=='json')throw new ApiError(400,'Choose one category source without an offset.');return Response.json(await uploadCategoryCSV(owner,c.id,request),{headers});}catch(error){return failure(error);}}
