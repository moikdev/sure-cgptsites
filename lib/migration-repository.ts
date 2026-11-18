import {transferRejectionColumns,transferRejectionValues} from './transfer-rejection-persistence';
import {rejectionColumns,rejectionValues} from "./recurring-matcher-persistence";
import {recurringPriceColumns,recurringPriceValues} from "./recurring-price-persistence";
import {fxCollections,fxColumns,fxValues,type FxCollection} from './fx-persistence';
import {contributionColumns,contributionValues} from './contribution-persistence';
import {planFileRecovery} from './file-recovery';
import {fileColumns,fileFields} from './statement-file-persistence';
import {statementSqlColumns,statementValues} from './reconciliation-persistence';
import {ruleCollections,ruleColumns,ruleValues} from './rule-persistence';
import {goalCollections,goalColumns,goalValues} from './goal-persistence';
import {budgetCollections,budgetColumns,budgetValues} from "./budget-persistence";
import {investmentCollections,investmentColumns,investmentValues} from "./investment-persistence";
import { z } from "zod";
import { ApiError, commitMutation, database, readState } from "./repository";
import { parseSureExport } from "./sure-export";
import { MAX_IMPORT_BYTES, parseSitesBackup, remapWorkspace, validateWorkspace, workspaceSummary, type WorkspaceData } from "./workspace";
import { recurringColumns, recurringValues, occurrenceColumns, occurrenceValues, allocationColumns, allocationValues } from "./ledger-persistence";
import type { RecurringEntry, RecurringOccurrence, RecurringAllocation } from "./finance";
import { CURRENCIES,today, validDate } from "./finance";

const migrationCommand = z.object({
  action: z.enum(["preview", "commit"]), sourceFormat: z.enum(["sites", "sure"]), content: z.string().min(1).max(MAX_IMPORT_BYTES),
  investmentReviewOffset:z.number().int().min(0).max(20000).default(0),useInvestmentRates:z.boolean().default(false),ruleCurrency:z.enum(CURRENCIES).optional(), includeFiles:z.boolean().default(true),
  exportDate: z.string().refine(validDate).optional(), mode: z.enum(["empty", "replace"]).default("empty"),
  expectedRevision: z.number().int().safe().nonnegative().optional(), receipt: z.string().length(64).optional(),
  confirmation: z.string().optional(), acknowledgeWarnings: z.boolean().default(false),
});
type Table = "manual_asset_details" | "credit_card_terms" | "account_details" | "account_archive_dates" | "transfer_match_rejections" | "recurring_match_rejections" | "recurring_price_changes" | "transaction_receipts" | "exchange_rates" | "transfer_details" | "transfer_fees" | "contribution_balances" | "statement_files" | "account_statements" | typeof ruleCollections[keyof typeof ruleCollections]["table"] | typeof goalCollections[keyof typeof goalCollections]["table"] | typeof budgetCollections[keyof typeof budgetCollections]["table"] | typeof investmentCollections[keyof typeof investmentCollections]["table"] | "accounts" | "categories" | "transactions" | "valuations" | "budgets" | "tags" | "merchants" | "split_lines" | "recurring_entries" | "recurring_occurrences" | "recurring_allocations";
function insertRows(table: Table, columns: string[], rows: (string | number | null)[][]): D1PreparedStatement[] {
  const db = database(), size = Math.floor(100 / columns.length), statements = [];
  for (let i = 0; i < rows.length; i += size) {
    const batch = rows.slice(i, i + size), placeholders = batch.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
    statements.push(db.prepare(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${placeholders}`).bind(...batch.flat()));
  }
  return statements;
}
export function replaceStatements(owner: string, data: WorkspaceData, alreadyRemapped=false): D1PreparedStatement[] {
  const db = database(), value = alreadyRemapped ? data : remapWorkspace(data);
  return [
    db.prepare("DELETE FROM transfer_match_rejections WHERE owner_id=?").bind(owner),
    db.prepare("DELETE FROM recurring_match_rejections WHERE owner_id=?").bind(owner),
    db.prepare("DELETE FROM recurring_price_changes WHERE owner_id=?").bind(owner),
    db.prepare("DELETE FROM transaction_receipts WHERE owner_id=?").bind(owner),
    ...["transfer_fees","transfer_details","exchange_rates"].map(table=>db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner)),
    db.prepare("DELETE FROM account_statements WHERE owner_id=?").bind(owner),
    ...["rule_runs","transaction_rules"].map(table=>db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner)),
    ...["goal_pledges","goal_consumptions","goal_accounts","goals"].map(table=>db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner)),
    ...(["budget_envelopes","budget_periods","budget_books"].map(table=>db.prepare(`DELETE FROM ${table} WHERE owner_id=?`).bind(owner))),
    ...(["contribution_balances","trades","holding_snapshots","investment_cash_balances","security_prices","security_splits","securities"].map(table=>db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).bind(owner))),
    ...(["recurring_allocations", "recurring_occurrences", "recurring_entries", "split_lines", "transactions", "valuations", "budgets", "categories", "accounts", "tags", "merchants"] as const).map(table => db.prepare(`DELETE FROM ${table} WHERE owner_id = ?`).bind(owner)),
    db.prepare("UPDATE profiles SET name = ?, currency = ?,market_fx=?,auto_transfer_disabled=? WHERE owner_id = ?").bind(value.profile.name, value.profile.currency,value.profile.marketFx,value.profile.autoTransferDisabled??null, owner),
    ...workspaceInsertStatements(owner,value),
  ];
}
export function workspaceInsertStatements(owner:string,value:WorkspaceData):D1PreparedStatement[]{
  return [
    ...insertRows("accounts", ["id", "owner_id", "name", "type", "currency", "opening_balance", "opening_date", "archived", "excluded_from_reports", "loan_terms","cash_planning_excluded","loan_replay"], value.accounts.map(a => [a.id, owner, a.name, a.type, a.currency, a.openingBalance, a.openingDate, a.archived, a.excludedFromReports,a.loanTerms?JSON.stringify(a.loanTerms):null,a.cashPlanningExcluded??null,a.loanReplay??null])),
    ...insertRows("manual_asset_details",["owner_id","account_id","details_json"],value.accounts.filter(a=>a.assetDetails).map(a=>[owner,a.id,JSON.stringify(a.assetDetails)])),
    ...insertRows("credit_card_terms",["owner_id","account_id","terms_json"],value.accounts.filter(a=>a.creditCardTerms).map(a=>[owner,a.id,JSON.stringify(a.creditCardTerms)])),
    ...insertRows("account_details",["owner_id","account_id","subtype","crypto_tax_treatment"],value.accounts.filter(a=>a.subtype!=null||a.cryptoTaxTreatment!=null).map(a=>[owner,a.id,a.subtype??null,a.cryptoTaxTreatment??null])),
    ...insertRows("account_archive_dates",["owner_id","account_id","archived_on"],value.accounts.filter(a=>a.archivedOn).map(a=>[owner,a.id,a.archivedOn!])),
    ...insertRows("categories", ["id", "owner_id", "name", "color", "parent_id","lucide_icon"], value.categories.map(c => [c.id, owner, c.name, c.color, c.parentId,c.lucideIcon??null])),
    ...insertRows("tags", ["id","owner_id","name","color"], value.tags.map(t => [t.id,owner,t.name,t.color])),
    ...insertRows("merchants", ["id","owner_id","name","color","website_url"], value.merchants.map(m => [m.id,owner,m.name,m.color,m.websiteUrl])),
    ...insertRows("account_statements",statementSqlColumns,value.accountStatements.map(s=>statementValues({...s,ownerId:owner}))),
    ...insertRows("transactions", ["investment_activity", "id", "owner_id", "account_id", "category_id", "date", "name", "amount", "kind", "transfer_id", "notes", "import_key", "excluded", "merchant_id", "tag_ids", "locked_fields","reconciled_status","reconciled_at","reconciled_statement_id"], value.transactions.map(t => [t.investmentActivity??null,t.id, owner, t.accountId, t.categoryId, t.date, t.name, t.amount, t.kind, t.transferId, t.notes, t.importKey, t.excluded, t.merchantId, JSON.stringify(t.tagIds),JSON.stringify(t.lockedFields),t.reconciledStatus,t.reconciledAt,t.reconciledStatementId])),
    ...insertRows("transfer_match_rejections",transferRejectionColumns,value.transferMatchRejections.map(r=>transferRejectionValues({...r,ownerId:owner}))),
    ...insertRows("split_lines", ["id","owner_id","transaction_id","position","name","amount","category_id","merchant_id","tag_ids","notes","kind","excluded","locked_fields","reconciliation_json"], value.splitLines.map(l => [l.id,owner,l.transactionId,l.position,l.name,l.amount,l.categoryId,l.merchantId,JSON.stringify(l.tagIds),l.notes,l.kind,l.excluded,JSON.stringify(l.lockedFields),l.reconciliation?JSON.stringify(l.reconciliation):null])),
    ...insertRows("recurring_entries", recurringColumns, value.recurringEntries.map(r => recurringValues({ ...r, ownerId: owner } as RecurringEntry))),
    ...insertRows("recurring_price_changes",recurringPriceColumns,value.recurringPriceChanges.map(p=>recurringPriceValues({...p,ownerId:owner}))),
    ...insertRows("recurring_match_rejections",rejectionColumns,value.recurringMatchRejections.map(r=>rejectionValues({...r,ownerId:owner}))),
    ...insertRows("recurring_occurrences", occurrenceColumns, value.recurringOccurrences.map(o => occurrenceValues({ ...o, ownerId: owner } as RecurringOccurrence))),
    ...insertRows("recurring_allocations", allocationColumns, value.recurringAllocations.map(a => allocationValues({ ...a, ownerId: owner } as RecurringAllocation))),
    ...insertRows("valuations", ["id", "owner_id", "account_id", "date", "amount", "name", "kind"], value.valuations.map(v => [v.id, owner, v.accountId, v.date, v.amount, v.name, v.kind])),
    ...Object.entries(investmentCollections).flatMap(([key,meta])=>{const collection=key as keyof typeof investmentCollections;return insertRows(meta.table,investmentColumns(collection),value[collection].map(row=>investmentValues(collection,{...row,ownerId:owner})));}),
    ...Object.entries(budgetCollections).flatMap(([key,meta])=>{const collection=key as keyof typeof budgetCollections;return insertRows(meta.table,budgetColumns(collection),value[collection].map(row=>budgetValues(collection,{...row,ownerId:owner})));}),
    ...Object.entries(ruleCollections).flatMap(([key,meta])=>{const collection=key as keyof typeof ruleCollections;return insertRows(meta.table,ruleColumns(collection),value[collection].map(row=>ruleValues(collection,{...row,ownerId:owner})));}),
    ...Object.entries(fxCollections).flatMap(([key,meta])=>insertRows(meta.table,fxColumns(key as FxCollection),value[key as FxCollection].map(row=>fxValues(key as FxCollection,{...row,ownerId:owner})))),
    ...insertRows("contribution_balances",contributionColumns,value.contributionBalances.map(b=>contributionValues({...b,ownerId:owner}))),
    ...Object.entries(goalCollections).flatMap(([key,meta])=>{const collection=key as keyof typeof goalCollections;return insertRows(meta.table,goalColumns(collection),value[collection].map(row=>goalValues(collection,{...row,ownerId:owner})));}),
    ...insertRows("budgets", ["id", "owner_id", "category_id", "month", "currency", "amount"], value.budgets.map(b => [b.id, owner, b.categoryId, b.month, b.currency, b.amount])),
  ];
}
async function digest(content: string) { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)); return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join(""); }
export async function migrateWorkspace(owner: string, input: unknown) {
  const parsed = migrationCommand.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "Choose a supported export file and preview it before importing.");
  const c = parsed.data;
  if (new TextEncoder().encode(c.content).length > MAX_IMPORT_BYTES) throw new ApiError(413, "Choose an export smaller than 8 MB.");
  const current = await readState(owner);
  if (!current.profile) throw new ApiError(409, "Create your workspace before importing a backup.");
  if (c.sourceFormat === "sure" && !c.exportDate) throw new ApiError(400, "Choose the date this Sure export was created.");
  if(c.sourceFormat!=='sure'&&c.useInvestmentRates)throw new ApiError(400,'Dated investment-rate conversion is only available for a Sure export. Sites backups retain their own applied quotes.');
  let migration;
  try { migration = c.sourceFormat === "sites" ? parseSitesBackup(c.content) : parseSureExport(c.content, { exportDate: c.exportDate!, name: current.profile.name, currency: current.profile.currency,ruleCurrency:c.ruleCurrency,marketFx:current.profile.marketFx===1?1:0,investmentRates:c.useInvestmentRates?current.exchangeRates:undefined,investmentReviewOffset:c.investmentReviewOffset }); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "The export could not be validated."); }
  if((current.profile.autoTransferDisabled===1)!==(migration.data.profile.autoTransferDisabled===1))migration.warnings.push(`This import changes automatic transfer matching from ${current.profile.autoTransferDisabled===1?'off':'on'} to ${migration.data.profile.autoTransferDisabled===1?'off':'on'}. Imported pending records are retained; restore does not run matching or clean them up.`);
  if (!c.includeFiles) {migration.data.statementFiles=[];migration.data.transactionReceipts=[];}
  const mapped=remapWorkspace(migration.data);
  let files;
  try { files=planFileRecovery(current.statementFiles,mapped.statementFiles);mapped.transactionReceipts=mapped.transactionReceipts.map(r=>({...r,fileId:files!.fileIds.get(r.fileId)!})); validateWorkspace({...mapped,statementFiles:files.merged}); }
  catch(error){throw new ApiError(409,error instanceof Error?error.message:'File recovery could not be prepared.');}
  if(files.recovery.missing) migration.warnings.push(`${files.recovery.missing} original file(s) will need to be re-uploaded. JSON contains metadata only. Re-uploading the same bytes restores their statement and receipt links.`);
  const revision = current.profile.revision;
  const receipt = await digest(JSON.stringify([c.sourceFormat, c.content, c.exportDate ?? null, c.ruleCurrency??null, c.mode, c.includeFiles,c.useInvestmentRates, revision]));
  const occupied = current.transferDetails.length + current.contributionBalances.length + current.goalPledges.length + current.accountStatements.length + current.rules.length + current.ruleRuns.length + current.goals.length + current.goalAccounts.length + current.goalConsumptions.length + current.accounts.length + current.transactions.length + current.valuations.length + current.budgets.length + current.recurringEntries.length + current.recurringOccurrences.length + current.recurringAllocations.length + current.trades.length + current.holdingSnapshots.length + current.investmentCashBalances.length + current.budgetPeriods.length + current.budgetEnvelopes.length > 0;
  if (c.mode === "empty" && occupied) throw new ApiError(409, "This workspace already contains records. Choose Replace workspace and download a backup first.");
  if (c.action === "preview") return { ...workspaceSummary(migration.data, c.sourceFormat === "sure" ? c.exportDate! : today()), investmentFx:migration.investmentFx,fileRecovery:files.recovery, warnings: migration.warnings, sourceCounts: migration.sourceCounts, expectedRevision: revision, receipt,
    replaced: { transferMatchRejections:current.transferMatchRejections.length,recurringMatchRejections:current.recurringMatchRejections.length,recurringPriceChanges:current.recurringPriceChanges.length,transactionReceipts:current.transactionReceipts.length,exchangeRates:current.exchangeRates.length,transferDetails:current.transferDetails.length,transferFees:current.transferFees.length,contributionBalances:current.contributionBalances.length,goalPledges:current.goalPledges.length,accountStatements:current.accountStatements.length,rules:current.rules.length,ruleRuns:current.ruleRuns.length,goals:current.goals.length,goalAccounts:current.goalAccounts.length,goalConsumptions:current.goalConsumptions.length,budgetBooks:current.budgetBooks.length,budgetPeriods:current.budgetPeriods.length,budgetEnvelopes:current.budgetEnvelopes.length, securities:current.securities.length,securityPrices:current.securityPrices.length,trades:current.trades.length,holdingSnapshots:current.holdingSnapshots.length,securitySplits:current.securitySplits.length,investmentCashBalances:current.investmentCashBalances.length, accounts: current.accounts.length, categories: current.categories.length, transactions: current.transactions.length, valuations: current.valuations.length, budgets: current.budgets.length, tags: current.tags.length, merchants: current.merchants.length, splitLines: current.splitLines.length, recurringEntries: current.recurringEntries.length, recurringOccurrences: current.recurringOccurrences.length, recurringAllocations: current.recurringAllocations.length }, mode: c.mode };
  if (c.expectedRevision !== revision || c.receipt !== receipt) throw new ApiError(409, "The file, options or workspace changed. Preview the import again.");
  if (c.confirmation !== (c.mode === "replace" ? "REPLACE" : "RESTORE")) throw new ApiError(400, `Type ${c.mode === "replace" ? "REPLACE" : "RESTORE"} to confirm this import.`);
  if (migration.warnings.length && !c.acknowledgeWarnings) throw new ApiError(400, "Review and acknowledge the migration notes before importing.");
  await commitMutation(owner, revision, [
    ...replaceStatements(owner,mapped,true),
    ...files.updates.map(f=>database().prepare('UPDATE statement_files SET statement_id=? WHERE owner_id=? AND id=?').bind(f.statementId,owner,f.id)),
    ...insertRows('statement_files',fileColumns,files.inserts.map(f=>fileFields.map(field=>field==='ownerId'?owner:f[field as keyof typeof f]))),
    ...insertRows('transaction_receipts',['id','owner_id','transaction_id','file_id','created_at'],mapped.transactionReceipts.map(r=>[r.id,owner,r.transactionId,r.fileId,r.createdAt])),
  ],37,{guardId:'category-restore:split-v36:'+crypto.randomUUID()});
  return { message: `Imported ${migration.data.accounts.length} accounts, ${migration.data.transactions.length} transactions, ${migration.data.valuations.length} balance records, and ${migration.data.budgetPeriods.length} budget periods.`, imported: workspaceSummary(migration.data, today()).counts };
}
