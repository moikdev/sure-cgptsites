import {getChatGPTUser} from '../../chatgpt-auth';
import {readJSON} from '../../../lib/http';
import {attachTransactionReceipt,fileFailure,privateFileHeaders} from '../../../lib/statement-files';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in with ChatGPT to continue.'},{status:401,headers:privateFileHeaders});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'This request must come from this website.'},{status:403,headers:privateFileHeaders});return Response.json(await attachTransactionReceipt(user.userId,await readJSON(request,10000)),{headers:privateFileHeaders});}catch(error){return fileFailure(error);}}
