import {getChatGPTUser} from '../../../chatgpt-auth';
import {restoreArchiveOriginal,archiveOriginalAvailability,fileFailure,privateFileHeaders} from '../../../../lib/statement-files';
export const dynamic='force-dynamic';
export async function POST(request:Request){try{
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in with ChatGPT to continue.'},{status:401,headers:privateFileHeaders});
 if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'This request must come from this website.'},{status:403,headers:privateFileHeaders});
 return Response.json(await restoreArchiveOriginal(user.userId,request),{headers:privateFileHeaders});
}catch(error){return fileFailure(error);}}

export async function GET(request:Request){try{const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in with ChatGPT to continue.'},{status:401,headers:privateFileHeaders});return Response.json(await archiveOriginalAvailability(user.userId,new URL(request.url).searchParams.get('sha256')),{headers:privateFileHeaders});}catch(error){return fileFailure(error);}}
