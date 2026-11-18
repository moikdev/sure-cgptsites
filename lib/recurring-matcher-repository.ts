import { ApiError, database, readState, commitMutation } from "./repository";
import { recurringMatcherCommandSchema } from "./recurring-matcher-schema";
import { planRecurringMatches, applyRecurringMatchPlan } from "./recurring-matcher";
import { rejectionColumns, rejectionValues } from "./recurring-matcher-persistence";
import { allocationColumns, allocationValues, occurrenceColumns, occurrenceValues } from "./ledger-persistence";
import { validateWorkspace } from "./workspace";
import { today, type FinanceState, type RecurringOccurrence } from "./finance";
import type { RecurringMatchRejection } from "./recurring-matcher-types";

function insert(table: string, columns: string[], values: (string | number | null)[]) { return database().prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...values); }
export function rejectionInsert(row: RecurringMatchRejection) { return insert("recurring_match_rejections", rejectionColumns, rejectionValues(row)); }
export function matcherSettingsUpdate(owner: string, id: string, settings: unknown) { return database().prepare("UPDATE recurring_entries SET matching=? WHERE owner_id=? AND id=?").bind(settings ? JSON.stringify(settings) : null, owner, id); }
function occurrenceWrite(row: RecurringOccurrence, fresh: boolean) {
  return fresh ? insert("recurring_occurrences", occurrenceColumns, occurrenceValues(row)) : database().prepare("UPDATE recurring_occurrences SET expected_amount=?,status=?,closed_at=?,closed_source=? WHERE owner_id=? AND id=?").bind(row.expectedAmount, row.status, row.closedAt, row.closedSource, row.ownerId, row.id);
}
export function matchPlanWrites(state:FinanceState,rows:ReturnType<typeof planRecurringMatches>['rows'],owner:string){
 const next=applyRecurringMatchPlan(state,rows,owner),statements:D1PreparedStatement[]=[],oldAllocations=new Set(state.recurringAllocations.map(a=>a.id)),oldOccurrences=new Set(state.recurringOccurrences.map(o=>o.id));
 for(const row of next.recurringAllocations.filter(a=>!oldAllocations.has(a.id))){const occurrence=next.recurringOccurrences.find(o=>o.id===row.occurrenceId)!;statements.push(occurrenceWrite(occurrence,!oldOccurrences.has(occurrence.id)),insert('recurring_allocations',allocationColumns,allocationValues(row)));}
 validateWorkspace({...next,budgets:[]});return {next,statements};
}
export async function executeRecurringMatcher(owner: string, input: unknown, revision: number) {
  const parsed = recurringMatcherCommandSchema.safeParse(input); if (!parsed.success) return null;
  const c = parsed.data, state = await readState(owner), db = database();
  if (state.profile?.revision !== revision) throw new ApiError(409, "Your workspace changed. Review the matching operation again.");
  if (c.action === "recurringMatchReview") {
    if (c.from > c.to || c.to > c.asOf || c.asOf > today()) throw new ApiError(400, "Choose a transaction range ending on or before the review date, through today.");
    if (c.recurringEntryId && !state.recurringEntries.some(e => e.id === c.recurringEntryId)) throw new ApiError(404, "Recurring schedule not found.");
    let plan: ReturnType<typeof planRecurringMatches>;
    try { plan = planRecurringMatches(state, c); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Matching could not be planned."); }
    if (c.offset && c.offset >= plan.rows.length) throw new ApiError(400, "Choose an available match review page.");
    const content = JSON.stringify(["recurring-match-review", owner, revision, c.from, c.to, c.asOf, c.writeMode, c.recurringEntryId ?? null]);
    const receipt = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)))].map(n => n.toString(16).padStart(2, "0")).join("");
    let prepared: ReturnType<typeof matchPlanWrites> | null = null, issue: string | null = null;
    try { prepared = matchPlanWrites(state, plan.rows, owner); } catch (error) { issue = error instanceof Error ? error.message : "These matches cannot be saved safely."; }
    if (c.mode === "preview") return { total: plan.rows.length, offset: c.offset, limit: 50, rows: plan.rows.slice(c.offset, c.offset + 50), confirmed: plan.rows.filter(r => r.tier === "confirmed").length, suggested: plan.rows.filter(r => r.tier === "suggested").length, contextCandidates: plan.contextCandidates, comparisons: plan.comparisons, openOccurrences: plan.openOccurrences, expectedRevision: revision, receipt, canCommit: !issue, issue };
    if (c.expectedRevision !== revision || c.receipt !== receipt) throw new ApiError(409, "Matching options or workspace records changed. Preview again.");
    if (!prepared) throw new ApiError(400, issue!);
    if (prepared.statements.length) await commitMutation(owner, revision, prepared.statements,20);
    return { message: `Linked ${plan.rows.filter(r => r.tier === "confirmed").length} confirmed payment(s) and created ${plan.rows.filter(r => r.tier === "suggested").length} suggestion(s). Ledger entries and balances are unchanged.` };
  }
  if (c.expectedRevision !== revision) throw new ApiError(409, "Your workspace changed. Reload matching settings first.");
  if (c.action === "recurringMatcherSettings") {
    if (!state.recurringEntries.some(e => e.id === c.recurringEntryId)) throw new ApiError(404, "Recurring schedule not found.");
    await commitMutation(owner, revision, [matcherSettingsUpdate(owner, c.recurringEntryId, c.settings)],20);
    return { message: "Matching settings saved. Run a review to link existing entries." };
  }
  if (c.action === "deleteRecurringMatchRejection") {
    if (!state.recurringMatchRejections.some(r => r.id === c.id)) throw new ApiError(404, "Rejected match not found.");
    await commitMutation(owner, revision, [db.prepare("DELETE FROM recurring_match_rejections WHERE owner_id=? AND id=?").bind(owner, c.id)],20);
    return { message: "Rejection removed. This source can be proposed for the schedule again." };
  }
  const entry = state.recurringEntries.find(e => e.id === c.recurringEntryId), source = state.transactions.find(t => t.id === c.transactionId);
  if (!entry || !source || c.splitLineId && !state.splitLines.some(l => l.id === c.splitLineId && l.transactionId === source.id)) throw new ApiError(404, "Schedule or source entry not found.");
  const allocations = state.recurringAllocations.filter(a => a.transactionId === source.id && a.splitLineId === c.splitLineId && state.recurringOccurrences.some(o => o.id === a.occurrenceId && o.recurringEntryId === entry.id));
  if (allocations.some(a => a.state === "confirmed")) throw new ApiError(409, "Remove the confirmed payment link before rejecting that source.");
  const statements: D1PreparedStatement[] = [];
  if (!state.recurringMatchRejections.some(r => r.recurringEntryId === entry.id && r.transactionId === source.id && r.splitLineId === c.splitLineId)) {
    if (state.recurringMatchRejections.length >= 10000) throw new ApiError(409, "Rejected-match memory is limited to 10,000 records.");
    statements.push(rejectionInsert({ id: crypto.randomUUID(), ownerId: owner, recurringEntryId: entry.id, transactionId: source.id, splitLineId: c.splitLineId }));
  }
  statements.push(...allocations.map(a => db.prepare("DELETE FROM recurring_allocations WHERE owner_id=? AND id=?").bind(owner, a.id)));
  if (statements.length) await commitMutation(owner, revision, statements,20);
  return { message: "This schedule/source pair is rejected. Future reviews will leave it out." };
}
