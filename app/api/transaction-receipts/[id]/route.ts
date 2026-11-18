import {z} from 'zod';
import {getChatGPTUser} from '../../../chatgpt-auth';
import {unlinkTransactionReceipt,fileFailure,privateFileHeaders} from '../../../../lib/statement-files';
export const dynamic='force-dynamic';
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}){try{const user=await getChatGPTUser();if(!user)return Response.json({error:'Sign in with ChatGPT to continue.'},{status:401,headers:privateFileHeaders});if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'This request must come from this website.'},{status:403,headers:privateFileHeaders});return Response.json(await unlinkTransactionReceipt(user.userId,z.string().uuid().parse((await context.params).id)),{headers:privateFileHeaders});}catch(error){return fileFailure(error);}}
