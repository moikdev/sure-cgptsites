export class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function readJSON(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new RequestError(415, "Send a JSON request.");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError(400, "Request body is required.");
  const decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RequestError(413, "The upload request is too large. Choose a smaller file."); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) { if (error instanceof RequestError) throw error; throw new RequestError(400, "The request is not valid UTF-8 text."); }
  try { return JSON.parse(text); } catch { throw new RequestError(400, "Invalid JSON."); }
}
