import { z } from "zod";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ApiError, readState } from "../../../lib/repository";
import { EXTRA_FREQUENCIES, createLoanProjectionReport, loanProjectionPage, loanProjectionCSV, LoanProjectionError } from "../../../lib/loan-projection";
import { today, validDate } from "../../../lib/finance";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" };
const integer = z.string().regex(/^(?:0|[1-9]\d{0,15})$/).transform(Number).refine(Number.isSafeInteger);
const querySchema = z.object({
  accountId: z.string().uuid(), asOf: z.string().refine(validDate).default(() => today()),
  extraAmount: integer.refine(n => n <= 1_000_000_000_000).default("0"),
  frequency: z.enum(EXTRA_FREQUENCIES).default("monthly"),
  offset: integer.refine(n => n <= 1199).default("0"), expectedRevision: integer.optional(),
  format: z.enum(["json", "csv"]).default("json"),
}).strict();
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new LoanProjectionError(401, "Sign in with ChatGPT to continue.");
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length > 1)) throw new LoanProjectionError(400, "Supply each projection option once.");
    const parsed = querySchema.safeParse(Object.fromEntries(params));
    if (!parsed.success) throw new LoanProjectionError(400, "Check the account, date, amount, frequency and page options.");
    const q = parsed.data;
    const report = createLoanProjectionReport(await readState(user.userId), q.accountId, { asOf: q.asOf, extraAmount: q.extraAmount, frequency: q.frequency }, q.expectedRevision);
    if (q.format === "csv") {
      if(!report.baseline.payments.length&&!report.scenario?.payments.length)throw new LoanProjectionError(400,"There are no projected payments to download.");
      if (q.offset) throw new LoanProjectionError(400, "Download the complete projection without a page offset.");
      return new Response(loanProjectionCSV(report), { headers: { ...headers, "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": 'attachment; filename="sure-loan-projection.csv"' } });
    }
    return Response.json(loanProjectionPage(report, q.offset), { headers });
  } catch (error) {
    if (error instanceof ApiError || error instanceof LoanProjectionError) return Response.json({ error: error.message }, { status: error.status, headers });
    if (error instanceof z.ZodError) return Response.json({ error: "The loan terms or projection options are invalid." }, { status: 400, headers });
    if (error instanceof Error && /supported money range|on or after origination/.test(error.message)) return Response.json({ error: error.message }, { status: 400, headers });
    console.error("loan_projection_failed");
    return Response.json({ error: "The projection could not be calculated. Reload your workspace before trying again." }, { status: 500, headers });
  }
}
