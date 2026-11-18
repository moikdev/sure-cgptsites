import { getChatGPTUser } from "../../chatgpt-auth";
import { ApiError } from "../../../lib/repository";
import { migrateWorkspace } from "../../../lib/migration-repository";
import { readJSON, RequestError } from "../../../lib/http";
export const dynamic = "force-dynamic";
function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" } }); }
export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser(); if (!user) return json({ error: "Sign in with ChatGPT to continue." }, 401);
    if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "This request must come from this website." }, 403);
    return json(await migrateWorkspace(user.userId, await readJSON(request, 10_000_000)));
  } catch (error) {
    if (error instanceof ApiError || error instanceof RequestError) return json({ error: error.message }, error.status);
    console.error("workspace_import_failed"); return json({ error: "The import could not be confirmed. Reload your workspace before retrying; a fresh preview is required." }, 500);
  }
}
