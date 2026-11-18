import {planRecurringSave} from "./recurring-save";
import {recurringStateWrites} from "./recurring-state-repository";
import {lifecycleKeys} from "./recurring-lifecycle-schema";
import { recurringCloseWorthy, learnMatcherAttach, preserveMatcherName, matcherDefaults } from "./recurring-matcher";
import { rejectionInsert, matcherSettingsUpdate } from "./recurring-matcher-repository";
import {resolvePaymentConversion,validatePaymentLink,sourceClaim} from './recurring-fx';
import {findRate,convertAtRate} from './fx';
import {fxColumns,fxValues} from './fx-persistence';
import {validateWorkspace} from './workspace';
import type {PaymentConversion} from './recurring-fx';
import type {TransferDetail} from './fx-types';
import { ApiError, commitMutation, database, insertTransaction, readState } from "./repository";
import { ledgerCommandSchema } from "./ledger-commands";
import { allocationColumns, allocationValues, occurrenceColumns, occurrenceValues } from "./ledger-persistence";
import { addDays, expectedOccurrenceAmount, schedulePairs, validateRecurringEntry } from "./recurring";
import { sumMinorUnits, today, transferKind, type FinanceState, type RecurringAllocation, type RecurringEntry, type RecurringOccurrence, type Transaction } from "./finance";

export async function metadataReferences(owner: string, merchantId: string | null, tagIds: string[]) {
  const db = database();
  const [merchant, tags] = await db.batch([db.prepare("SELECT id FROM merchants WHERE owner_id = ? AND id = ?").bind(owner, merchantId), db.prepare("SELECT id FROM tags WHERE owner_id = ?").bind(owner)]);
  if (merchantId && !merchant.results.length) throw new ApiError(404, "Merchant not found.");
  const own = new Set(tags.results.map(row => (row as { id: string }).id));
  if (tagIds.some(id => !own.has(id))) throw new ApiError(404, "Tag not found.");
}
function assertReferences(state: FinanceState, categoryId: string | null, merchantId: string | null, tagIds: string[]) {
  if (categoryId && !state.categories.some(c => c.id === categoryId)) throw new ApiError(404, "Category not found.");
  if (merchantId && !state.merchants.some(m => m.id === merchantId)) throw new ApiError(404, "Merchant not found.");
  if (tagIds.some(id => !state.tags.some(tag => tag.id === id))) throw new ApiError(404, "Tag not found.");
}
function preparedInsert(table: string, columns: string[], values: (string | number | null)[]) { return database().prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`).bind(...values); }
function expected(entry: RecurringEntry, occurrence: RecurringOccurrence, state: FinanceState) { return expectedOccurrenceAmount(entry, occurrence, state.recurringOccurrences, state.recurringAllocations); }
function selectOccurrence(state: FinanceState, entry: RecurringEntry, originalDueOn: string) {
  const found = state.recurringOccurrences.find(o => o.recurringEntryId === entry.id && o.originalDueOn === originalDueOn);
  if (found) return { occurrence: found, fresh: false };
  const pair = schedulePairs(entry, addDays(originalDueOn, -3) < "1900-01-01" ? "1900-01-01" : addDays(originalDueOn, -3), addDays(originalDueOn, 3) > "2199-12-31" ? "2199-12-31" : addDays(originalDueOn, 3)).find(p => p.originalDueOn === originalDueOn);
  if (!pair) throw new ApiError(409, "This date is no longer part of the schedule. Refresh the list.");
  const occurrence: RecurringOccurrence = { ...pair, id: crypto.randomUUID(), ownerId: entry.ownerId, recurringEntryId: entry.id, currency: entry.currency, expectedAmount: null, status: "scheduled", snoozedUntil: null, closedAt: null, closedSource: null, notes: "" };
  return { occurrence, fresh: true };
}
function saveOccurrence(occurrence: RecurringOccurrence, fresh: boolean) {
  if (fresh) return preparedInsert("recurring_occurrences", occurrenceColumns, occurrenceValues(occurrence));
  return database().prepare("UPDATE recurring_occurrences SET due_on = ?, expected_amount = ?, status = ?, snoozed_until = ?, closed_at = ?, closed_source = ?, notes = ? WHERE owner_id = ? AND id = ?")
    .bind(occurrence.dueOn, occurrence.expectedAmount, occurrence.status, occurrence.snoozedUntil, occurrence.closedAt, occurrence.closedSource, occurrence.notes, occurrence.ownerId, occurrence.id);
}
function settle(occurrence: RecurringOccurrence, entry: RecurringEntry, allocations: RecurringAllocation[], state: FinanceState) {
  const amounts = allocations.filter(a => a.occurrenceId === occurrence.id && a.state === "confirmed").map(a => a.amount), cost = expected(entry, occurrence, state), closed = recurringCloseWorthy(entry,cost,amounts);
  return { ...occurrence, status: closed ? "paid" as const : "scheduled" as const, expectedAmount: occurrence.expectedAmount ?? cost, closedAt: closed ? new Date().toISOString() : null, closedSource: closed ? "user" : null };
}
function validateLinkedPayment(state:FinanceState,entry:RecurringEntry,transaction:Transaction,amount:number,excludeAllocationId?:string,splitLineId:string|null=null){if(transaction.date>today())throw new ApiError(400,'Choose a posted transaction.');try{return validatePaymentLink(state,entry,transaction,amount,splitLineId,excludeAllocationId);}catch(e){throw new ApiError(400,(e as Error).message);}}
const paymentFingerprint=async(value:unknown)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function executeLedgerCommand(owner: string, input: unknown, revision: number): Promise<{ message: string } | null> {
  const parsed = ledgerCommandSchema.safeParse(input); if (!parsed.success) return null;
  const c = parsed.data, db = database(), state = await readState(owner);
  if (state.profile?.revision !== revision) throw new ApiError(409, "Your workspace changed. Reload and try again.");
  const apply = (statements: D1PreparedStatement[]) => commitMutation(owner, revision, statements,28);
  const root = (id: string) => { const entry = state.transactions.find(t => t.id === id); if (!entry) throw new ApiError(404, "Transaction not found."); return entry; };
  const series = (id: string) => { const entry = state.recurringEntries.find(t => t.id === id); if (!entry) throw new ApiError(404, "Recurring entry not found."); return entry; };
  switch (c.action) {
    case "tag": {
      if (c.id && !state.tags.some(t => t.id === c.id)) throw new ApiError(404, "Tag not found.");
      if (state.tags.some(t => t.id !== c.id && t.name.toLowerCase() === c.name.toLowerCase())) throw new ApiError(409, "A tag with this name already exists.");
      await apply([c.id ? db.prepare("UPDATE tags SET name = ?, color = ? WHERE owner_id = ? AND id = ?").bind(c.name, c.color, owner, c.id) : db.prepare("INSERT INTO tags (id, owner_id, name, color) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), owner, c.name, c.color)]); break;
    }
    case "deleteTag": {
      if (!state.tags.some(t => t.id === c.id)) throw new ApiError(404, "Tag not found.");
      await apply([...(["transactions", "split_lines", "recurring_entries"] as const).map(table => db.prepare(`UPDATE ${table} SET tag_ids = (SELECT json_group_array(value) FROM json_each(tag_ids) WHERE value != ?) WHERE owner_id = ? AND EXISTS (SELECT 1 FROM json_each(tag_ids) WHERE value = ?)`).bind(c.id, owner, c.id)), db.prepare("DELETE FROM tags WHERE owner_id = ? AND id = ?").bind(owner, c.id)]); break;
    }
    case "merchant": {
      if (c.id && !state.merchants.some(m => m.id === c.id)) throw new ApiError(404, "Merchant not found.");
      await apply([c.id ? db.prepare("UPDATE merchants SET name = ?, color = ?, website_url = ? WHERE owner_id = ? AND id = ?").bind(c.name, c.color, c.websiteUrl, owner, c.id) : db.prepare("INSERT INTO merchants (id, owner_id, name, color, website_url) VALUES (?, ?, ?, ?, ?)").bind(crypto.randomUUID(), owner, c.name, c.color, c.websiteUrl)]); break;
    }
    case "deleteMerchant": {
      if (!state.merchants.some(m => m.id === c.id)) throw new ApiError(404, "Merchant not found.");
      await apply([...(["transactions", "split_lines", "recurring_entries"] as const).map(table => db.prepare(`UPDATE ${table} SET merchant_id = NULL WHERE owner_id = ? AND merchant_id = ?`).bind(owner, c.id)), db.prepare("DELETE FROM merchants WHERE owner_id = ? AND id = ?").bind(owner, c.id)]); break;
    }
    case "transactionMetadata": {
      root(c.id); assertReferences(state, null, c.merchantId, c.tagIds);
      await apply([db.prepare("UPDATE transactions SET merchant_id = ?, tag_ids = ? WHERE owner_id = ? AND id = ?").bind(c.merchantId, JSON.stringify(c.tagIds), owner, c.id)]); break;
    }
    case "setSplit": {
      const transaction = root(c.id);
      if (transaction.transferId) throw new ApiError(400, "Transfers cannot be split.");
      if(state.transferFees.some(f=>f.transactionId===transaction.id)&&c.amount!==transaction.amount)throw new ApiError(400,"A linked transfer fee keeps its recorded total.");
      if (state.accounts.find(a => a.id === transaction.accountId)?.archived) throw new ApiError(400, "Restore the account before editing its splits.");
      if (sumMinorUnits(c.lines.map(line => line.amount)) !== c.amount) throw new ApiError(400, "Split amounts must add up exactly to the purchase total.");
      c.lines.forEach(line => assertReferences(state, line.categoryId, line.merchantId, line.tagIds));
      if (c.amount !== transaction.amount && state.recurringAllocations.some(a => a.transactionId === transaction.id)) throw new ApiError(400, "Remove the bill payment link before changing this transaction’s amount.");
      await apply([
        db.prepare("UPDATE recurring_allocations SET transaction_id=CASE WHEN split_line_id IS NOT NULL THEN NULL ELSE transaction_id END,split_line_id = NULL WHERE owner_id = ? AND transaction_id = ?").bind(owner, c.id),
        db.prepare("DELETE FROM split_lines WHERE owner_id = ? AND transaction_id = ?").bind(owner, c.id),
        db.prepare("UPDATE transactions SET amount = ? WHERE owner_id = ? AND id = ?").bind(c.amount, owner, c.id),
        ...c.lines.map((line, position) => db.prepare("INSERT INTO split_lines (id, owner_id, transaction_id, position, name, amount, category_id, merchant_id, tag_ids, notes, kind, excluded, reconciliation_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), owner, c.id, position, line.name, line.amount, line.categoryId, line.merchantId, JSON.stringify(line.tagIds), line.notes, line.kind, line.excluded, JSON.stringify({status:"unreconciled",at:null}))),
      ]); break;
    }
    case "clearSplit": {
      const transaction = root(c.id);
      if (state.accounts.find(a => a.id === transaction.accountId)?.archived) throw new ApiError(400, "Restore the account before editing its splits.");
      await apply([db.prepare("UPDATE recurring_allocations SET transaction_id=CASE WHEN split_line_id IS NOT NULL THEN NULL ELSE transaction_id END,split_line_id = NULL WHERE owner_id = ? AND transaction_id = ?").bind(owner, c.id), db.prepare("DELETE FROM split_lines WHERE owner_id = ? AND transaction_id = ?").bind(owner, c.id)]); break;
    }
    case "recurring": {
      if (c.id) series(c.id);
      assertReferences(state, c.categoryId, c.merchantId, c.tagIds);
      for (const id of [c.accountId, c.destinationAccountId]) if (id) { const account = state.accounts.find(a => a.id === id); if (!account) throw new ApiError(404, "Account not found."); }
      try { validateRecurringEntry(c); } catch (error) { throw new ApiError(400, (error as Error).message); }
      const entry: RecurringEntry = { ...c, id: c.id ?? crypto.randomUUID(), ownerId: owner };delete (entry as unknown as Record<string,unknown>).action;
      if (c.expectedAmountMin !== null && c.expectedAmountMax !== null && c.expectedAmountMin > c.expectedAmountMax) throw new ApiError(400, "Expected minimum cannot exceed the maximum.");
      const previous = c.id ? series(c.id) : null;
      if(previous)for(const key of ['lastOccurrenceOn','occurrenceCount','updatedAt'] as const)if(previous[key]!==undefined)(entry as unknown as Record<string,unknown>)[key]=previous[key];
      if(previous?.manual!==undefined)entry.manual=previous.manual;else if(!previous)entry.manual=1;
      if(previous)for(const key of lifecycleKeys)if(previous[key]!==undefined)entry[key]=previous[key];
      if(previous?.matching)entry.matching=preserveMatcherName(previous,entry.name);else if(previous&&(previous.manual===0||previous.name!==entry.name))entry.matching={...matcherDefaults(),detectedName:previous.name!==entry.name?previous.name:null};
      if(previous?.manual===0&&["anchorDate","expectedDayOfMonth","rules","endMode","endOn","endAfterCount","weekendAdjust"].some(key=>JSON.stringify((previous as unknown as Record<string,unknown>)[key])!==JSON.stringify((entry as unknown as Record<string,unknown>)[key])))entry.matching={...(entry.matching??matcherDefaults()),sourceHints:{...entry.matching?.sourceHints,schedule_pinned_at:new Date().toISOString()}};
      let report;try{report=planRecurringSave(state,entry,today());}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Schedule cannot be saved.');}
      const {statements}=recurringStateWrites(owner,state,report.next);if(statements.length)await apply(statements);
      return {message:`Schedule saved. Created ${report.changes.created.length} reminder(s), rebuilt/removed ${report.changes.removed.length} regeneratable reminder(s).${report.historyCompleted?` Reconstructed history and linked ${report.historyMatched} payment(s); pruned ${report.historyPruned} uncovered older reminder(s).`:''}${report.historyFutureMatched?` ${report.historyFutureMatched} link(s) use future-dated recorded entries; these do not prove a posted payment.`:''}${report.issues.length?' '+report.issues.join(' '):''} Account entries and balances are unchanged.`};
    }
    case "deleteRecurring": {
      const deleting=series(c.id);if(deleting.manual===0){if(deleting.status==="ended")return {message:"This detected schedule is already dismissed."};return executeLedgerCommand(owner,{...deleting,action:"recurring",status:"ended"},revision);}
      await apply([db.prepare("DELETE FROM recurring_entries WHERE owner_id = ? AND id = ?").bind(owner, c.id)]); break;
    }
    case "occurrence": {
      const entry = series(c.recurringEntryId), { occurrence, fresh } = selectOccurrence(state, entry, c.originalDueOn);
      if (c.operation === "skip" || c.operation === "miss") { occurrence.expectedAmount = expected(entry, occurrence, state); occurrence.status = c.operation === "skip" ? "skipped" : "missed"; occurrence.closedAt = new Date().toISOString(); occurrence.closedSource = "user"; }
      if (c.operation === "reopen") { occurrence.status = "scheduled"; occurrence.closedAt = null; occurrence.closedSource = null; }
      if (c.operation === "snooze") { if (c.snoozedUntil === undefined) throw new ApiError(400, "Choose a snooze date."); occurrence.snoozedUntil = c.snoozedUntil; }
      if (c.operation === "edit") { if (c.dueOn) occurrence.dueOn = c.dueOn; if (c.expectedAmount !== undefined) occurrence.expectedAmount = c.expectedAmount; if (c.notes !== undefined) occurrence.notes = c.notes; }
      await apply([saveOccurrence(occurrence, fresh)]); break;
    }
    case "payOccurrence": {
      const entry=series(c.recurringEntryId),fingerprint=await paymentFingerprint([owner,c.recurringEntryId,c.originalDueOn,c.mode,c.transactionId,c.splitLineId,c.accountId,c.amount,c.paidOn,c.sourceAmount??null]),prior=state.recurringAllocations.find(a=>a.id===c.requestId);
      if(prior){const occurrence=state.recurringOccurrences.find(o=>o.id===prior.occurrenceId)!;if(prior.requestFingerprint?prior.requestFingerprint!==fingerprint:occurrence.recurringEntryId!==entry.id||occurrence.originalDueOn!==c.originalDueOn||prior.amount!==c.amount||prior.paidOn!==c.paidOn||c.mode==='link'&&prior.transactionId!==c.transactionId||c.mode==='record'&&!!prior.transactionId)throw new ApiError(409,'This payment request was already used with different details.');return {message:'This payment was already recorded.'};}
      if(entry.status!=='active')throw new ApiError(400,'Activate this schedule before recording a payment.');if(c.paidOn>today())throw new ApiError(400,'Payment dates cannot be in the future.');if(c.mode!=='link'&&(c.transactionId||c.splitLineId)||c.mode!=='new'&&c.accountId||c.mode==='record'&&c.sourceAmount!==undefined)throw new ApiError(400,'Only transaction-backed payments accept transaction/account amount fields.');
      const {occurrence,fresh}=selectOccurrence(state,entry,c.originalDueOn);if(occurrence.status!=='scheduled')throw new ApiError(409,'This occurrence is closed. Reopen it to change its payments.');
      const statements:D1PreparedStatement[]=[],created:Transaction[]=[],transferDetails:TransferDetail[]=[];let transactionId:string|null=null,conversion:PaymentConversion|null=null,message='Payment recorded.';
      try{
        if(c.mode==='link'){if(!c.transactionId)throw new ApiError(400,'Choose an existing transaction.');const transaction=root(c.transactionId);conversion=resolvePaymentConversion(state,transaction.accountId,occurrence.currency,c.amount,transaction.date,c.sourceAmount);validateLinkedPayment(state,entry,transaction,conversion.sourceAmount,undefined,c.splitLineId);transactionId=transaction.id;}
        if(c.mode==='new'){
          if(entry.accountId&&c.accountId&&entry.accountId!==c.accountId)throw new ApiError(400,'Use the schedule’s assigned account.');const account=state.accounts.find(a=>a.id===(entry.accountId??c.accountId));if(!account)throw new ApiError(400,'Assign or choose an account before creating a payment transaction.');if(account.archived||c.paidOn<account.openingDate)throw new ApiError(400,'Restore the account and use a date after its opening date.');
          conversion=resolvePaymentConversion(state,account.id,occurrence.currency,c.amount,c.paidOn,c.sourceAmount);transactionId=crypto.randomUUID();const base={ownerId:owner,categoryId:entry.categoryId,date:c.paidOn,name:entry.name,notes:entry.notes,importKey:null,merchantId:entry.merchantId,tagIds:entry.tagIds,excluded:0};
          if(entry.billType==='transfer'){
            const destination=state.accounts.find(a=>a.id===entry.destinationAccountId);if(!destination||destination.archived||destination.id===account.id||c.paidOn<destination.openingDate)throw new ApiError(400,'Choose a valid active destination after its opening date.');const q=findRate(state,account.currency,destination.currency,c.paidOn);if(!q)throw new ApiError(400,'Add an eligible source-to-destination exchange rate for this transfer date.');const into=convertAtRate(conversion.sourceAmount,account.currency,destination.currency,q,1_000_000_000_000);if(into<=0)throw new ApiError(400,'The receiving transfer amount rounds to zero.');const transferId=crypto.randomUUID();
            created.push({...base,id:transactionId,accountId:account.id,amount:-conversion.sourceAmount,kind:transferKind(account.type,destination.type),transferId},{...base,id:crypto.randomUUID(),accountId:destination.id,amount:into,kind:'funds_movement',transferId,categoryId:null});
            transferDetails.push({id:transferId,ownerId:owner,date:c.paidOn,destinationDate:c.paidOn,fromCurrency:account.currency,toCurrency:destination.currency,fromAmount:conversion.sourceAmount,toAmount:into,rateNumerator:String(q.numerator),rateDenominator:String(q.denominator),rateDate:q.source==='identity'?null:q.date,rateSource:q.source,sourceFee:0,destinationFee:0,requestId:null,requestFingerprint:null});
          }else created.push({...base,id:transactionId,accountId:account.id,amount:(entry.billType==='income'||entry.amount>0?1:-1)*conversion.sourceAmount,kind:'standard',transferId:null});
        }
        const allocation:RecurringAllocation={id:c.requestId,ownerId:owner,occurrenceId:occurrence.id,transactionId,splitLineId:c.mode==='link'?c.splitLineId:null,amount:c.amount,currency:occurrence.currency,sourceAmount:conversion?.sourceAmount??null,sourceCurrency:conversion?.sourceCurrency??null,state:'confirmed',source:c.mode==='link'?'user_confirmed':'user_created',paidOn:c.paidOn,conversion,requestFingerprint:fingerprint};
        if(c.mode==='link' && transactionId && entry.matching){
          const source=root(transactionId),part=c.splitLineId?state.splitLines.find(l=>l.id===c.splitLineId):null;
          const settings=learnMatcherAttach(entry,part?.name??source.name,Math.abs(part?.amount??source.amount),expected(entry,occurrence,state),[...state.recurringAllocations,allocation].filter(a=>a.occurrenceId===occurrence.id&&a.state==='confirmed').map(a=>a.amount));
          if(settings)statements.push(matcherSettingsUpdate(owner,entry.id,settings));
        }
        const updated=settle(occurrence,entry,[...state.recurringAllocations,allocation],state),next={...state,transactions:[...state.transactions,...created],transferDetails:[...state.transferDetails,...transferDetails],recurringOccurrences:state.recurringOccurrences.filter(o=>o.id!==updated.id).concat(updated),recurringAllocations:[...state.recurringAllocations,allocation]};validateWorkspace({...next,budgets:[]});
        for(const detail of transferDetails){const columns=fxColumns('transferDetails');statements.push(db.prepare(`INSERT INTO transfer_details (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...fxValues('transferDetails',detail)));}
        statements.push(...created.map(t=>insertTransaction(owner,t)),preparedInsert('recurring_allocations',allocationColumns,allocationValues(allocation)));statements.unshift(saveOccurrence(updated,fresh));message=updated.status==='paid'?'Payment recorded. This occurrence is paid.':'Partial payment recorded.';
      }catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,(e as Error).message);}
      await apply(statements);return {message};
    }
    case "deleteAllocation": case "confirmAllocation": {
      if(c.action==="deleteAllocation"&&c.expectedRevision!==undefined&&c.expectedRevision!==revision)throw new ApiError(409,"This payment record changed. Reload before removing or rejecting it.");
      const allocation=state.recurringAllocations.find(a=>a.id===c.id);if(!allocation)throw new ApiError(404,'Payment record not found.');const occurrence=state.recurringOccurrences.find(o=>o.id===allocation.occurrenceId)!,entry=series(occurrence.recurringEntryId);let row=allocation;
      if(c.action==='confirmAllocation'){
        if(allocation.state==='confirmed'){if(c.sourceAmount!==undefined&&c.sourceAmount!==allocation.sourceAmount)throw new ApiError(409,'This payment was already confirmed with another account amount.');return {message:'This payment is already confirmed.'};}if(entry.status!=='active')throw new ApiError(400,'Activate the schedule before confirming a suggestion.');
        if(allocation.transactionId){const transaction=root(allocation.transactionId),account=state.accounts.find(a=>a.id===transaction.accountId)!;try{const saved=allocation.conversion;if(saved&&c.sourceAmount!==undefined&&c.sourceAmount!==saved.sourceAmount)throw new Error('The saved payment conversion retains its account amount.');const native=c.sourceAmount??sourceClaim(allocation,account.currency)??undefined,conversion=saved??resolvePaymentConversion(state,account.id,occurrence.currency,allocation.amount,transaction.date,native,c.sourceAmount!==undefined?'manual':'imported');validateLinkedPayment(state,entry,transaction,conversion.sourceAmount,allocation.id,allocation.splitLineId);row={...allocation,sourceAmount:conversion.sourceAmount,sourceCurrency:conversion.sourceCurrency,conversion,state:'confirmed',source:'user_confirmed'};}catch(e){if(e instanceof ApiError)throw e;throw new ApiError(400,(e as Error).message);}}
        else row={...allocation,state:'confirmed',source:'user_confirmed'};
      }
      const allocations=c.action==='deleteAllocation'?state.recurringAllocations.filter(a=>a.id!==c.id):state.recurringAllocations.map(a=>a.id===c.id?row:a),updated=settle(occurrence,entry,allocations,state);
      try{validateWorkspace({...state,recurringAllocations:allocations,recurringOccurrences:state.recurringOccurrences.map(o=>o.id===updated.id?updated:o),budgets:[]});}catch(e){throw new ApiError(400,(e as Error).message);}
      const rejectionStatements:D1PreparedStatement[]=[];
      if(c.action==='deleteAllocation' && allocation.state==='suggested' && allocation.transactionId && !state.recurringMatchRejections.some(r=>r.recurringEntryId===entry.id&&r.transactionId===allocation.transactionId&&r.splitLineId===allocation.splitLineId)){
        if(state.recurringMatchRejections.length>=10000)throw new ApiError(409,'Rejected-match memory is limited to 10,000 records.');
        rejectionStatements.push(rejectionInsert({id:crypto.randomUUID(),ownerId:owner,recurringEntryId:entry.id,transactionId:allocation.transactionId,splitLineId:allocation.splitLineId}));
      }
      await apply([...rejectionStatements,c.action==='deleteAllocation'?db.prepare('DELETE FROM recurring_allocations WHERE owner_id=? AND id=?').bind(owner,c.id):db.prepare('UPDATE recurring_allocations SET state=?,source=?,source_amount=?,source_currency=?,conversion=? WHERE owner_id=? AND id=?').bind(row.state,row.source,row.sourceAmount,row.sourceCurrency,row.conversion?JSON.stringify(row.conversion):null,owner,row.id),saveOccurrence(updated,false)]);break;
    }
  }
  return { message: "Saved successfully." };
}
