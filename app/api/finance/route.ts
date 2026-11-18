import {capturePledgeState,reconcileNewSavings} from '../../../lib/pledge-repository';
import { getChatGPTUser } from "../../chatgpt-auth";
import { ApiError, readState, executeCommand } from "../../../lib/repository";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: responseHeaders }); }
function failure(error: unknown) {
  if (error instanceof ApiError) return json({ error: error.message }, error.status);
  // Database errors may include customer data; return and log only a generic code.
  console.error("finance_operation_failed");
  return json({ error: "The operation could not be completed. Reload and try again." }, 500);
}
export async function GET() {
  try { const user = await getChatGPTUser(); if (!user) return json({ error: "Sign in with ChatGPT to continue." }, 401); return json(await readState(user.userId)); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) return json({ error: "Sign in with ChatGPT to continue." }, 401);
    if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "This request must come from this website." }, 403);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Send a JSON request." }, 415);
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Request body is required." }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 1_100_000) { await reader.cancel(); return json({ error: "Import file is too large (maximum 1 MB)." }, 413); }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes);
    let input: unknown; try { input = JSON.parse(text); } catch { return json({ error: "Invalid JSON." }, 400); }
    let before=null,checkFailed=false;try{before=await capturePledgeState(user.userId,input);}catch{checkFailed=true;}
    const result=await executeCommand(user.userId,input,before?.profile?.revision);
    if(before)try{const check=await reconcileNewSavings(user.userId,before);if(check.missingRates)checkFailed=true;const matched=check.matched;if(matched&&typeof result==='object'&&result!==null&&'message' in result&&typeof result.message==='string')result.message+=` Matched ${matched} pending savings pledge(s).`;}catch{checkFailed=true;console.error('automatic_pledge_check_failed');}
    if(checkFailed&&typeof result==='object'&&result!==null&&'message' in result&&typeof result.message==='string')result.message+=' Pending savings could not be checked; use the goal matching preview to review recorded inflows. Balance pledges will be checked on the next positive balance update.';
    return json(result);
  } catch (error) { return failure(error); }
}
