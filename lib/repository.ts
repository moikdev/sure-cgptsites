import {normalizeAssetDetails} from './manual-asset-schema';import {manualAssetDetailsStatements} from './manual-asset-persistence';import {planVehiclePurchase} from './manual-asset';
import {normalizeCardTerms} from './credit-card-schema';
import {cardTermsStatements} from './credit-card-persistence';
import {validateAccountDetails,ACCOUNTABLE_TYPES} from './account-details';
import {accountDetailsStatements} from './account-details-persistence';
import {validateArchiveDate} from './account-archive';
import {createCSVTemplate} from './csv-template';
import {csvTemplateStatement,saveDuplicateImportTemplate} from './csv-template-repository';
import {executeInvestmentReporting} from './investment-reporting-repository';
import {executeInvestmentTransferRepair} from './transfer-kind-repair-repository';
import {executeAutomaticTransfers} from './transfer-auto-repository';
import {executeTransferClassification} from './transfer-classification-repository';
import {executeTransferRejection} from './transfer-rejection-repository';
import {transferRejectionSelect} from './transfer-rejection-persistence';
import {executeTransferCounterpart} from './transfer-counterpart-repository';
import {executeTransferMatch} from './transfer-match-repository';
import {executeLoanReplay} from './loan-replay-repository';
import {validateLoanReplayAccount} from './loan-replay-report';
import {executeRecurringCleanup} from './recurring-cleanup-repository';
import {executeRecurringMaintenance} from "./recurring-maintenance-repository";
import {executeRecurringDetection} from "./recurring-detection-repository";
import {executePaycheckPreference} from "./paycheck-repository";
import {executeRecurringLifecycle} from "./recurring-lifecycle-repository";
import { executeRecurringMatcher } from "./recurring-matcher-repository";
import { rejectionSelect } from "./recurring-matcher-persistence";
import {executeRecurringPrice} from "./recurring-price-repository";
import {recurringPriceSelect} from "./recurring-price-persistence";
import {loanSchedule} from "./loans";
import {executeMarketPricing} from './market-fx-repository';
import {fxCollections,fxSelect,type FxCollection} from './fx-persistence';
import {executeFxCommand,executeTransferCommand,transferDeleteStatements} from './fx-repository';
import {contributionSelect} from './contribution-persistence';
import {executeContributionCommand} from './contribution-repository';
import {executePledgeCommand} from './pledge-repository';
import {fileSelect} from './statement-file-persistence';
import {executeReconciliationCommand} from './reconciliation-repository';
import {statementSelect,decodeStatement} from './reconciliation-persistence';
import {executeRuleCommand,ruleResultStatements,ruleValidationWorkspace} from './rule-repository';
import {evaluateRules} from './rules';
import {validateWorkspace} from './workspace';
import {ruleCollections,ruleSelect,decodeRuleRow} from './rule-persistence';
import {executeGoalCommand} from './goal-repository';
import {decodeGoalRow,goalCollections,goalSelect} from './goal-persistence';
import {executeBudgetCommand} from "./budget-repository";
import {legacyBudgetProjection} from "./budget";
import {budgetCollections,budgetSelect,decodeBudgetRow} from "./budget-persistence";
import {executeInvestmentCommand} from "./investment-repository";
import {investmentCollections,investmentSelect,decodeInvestmentRow} from "./investment-persistence";
import { env } from "cloudflare:workers";
import { commandSchema } from "./validation";
import { DEFAULT_CATEGORIES, transferKind, type Valuation, type FinanceState, type Account, type Category, type Transaction, type Budget, type Profile, type Tag, type Merchant, type RecurringOccurrence, type RecurringAllocation } from "./finance";
import { importRows } from "./csv";
import { executeLedgerCommand, metadataReferences } from "./ledger-repository";
import { allocationSelect, occurrenceSelect, recurringSelect, decodeTransaction, decodeAllocation,decodeRecurring, decodeSplit } from "./ledger-persistence";

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export function database() { if (!env.DB) throw new ApiError(503, "Finance storage is unavailable. Please try again later."); return env.DB; }
export async function commitMutation(owner: string, revision: number, statements: D1PreparedStatement[],clientEpoch=28,options?:{guardId?:string;incrementRevision?:boolean}) {
  const db = database(), guard = options?.guardId??crypto.randomUUID(),increment=options?.incrementRevision!==false;
  try {
    const results = await db.batch([
      db.prepare("INSERT INTO workspace_guards (id, owner_id, expected_revision, client_epoch) VALUES (?, ?, ?, ?)").bind(guard, owner, revision,clientEpoch),
      ...statements,
      ...(increment?[db.prepare("UPDATE profiles SET revision = revision + 1 WHERE owner_id = ?").bind(owner)]:[]),
      db.prepare("DELETE FROM workspace_guards WHERE id = ? AND owner_id = ?").bind(guard, owner),
    ]);
    return results.slice(1, increment?-2:-1);
  } catch (error) {
    if (error instanceof Error && error.message.includes("workspace_changed")) throw new ApiError(409, "Your workspace changed. Reload the latest data and preview the operation again.");
    throw error;
  }
}
const accountSelect = "id, owner_id AS ownerId, name, type, currency, opening_balance AS openingBalance, opening_date AS openingDate, archived, excluded_from_reports AS excludedFromReports,loan_terms AS loanTerms,cash_planning_excluded AS cashPlanningExcluded,loan_replay AS loanReplay,(SELECT archived_on FROM account_archive_dates ad WHERE ad.owner_id=accounts.owner_id AND ad.account_id=accounts.id) AS archivedOn,(SELECT subtype FROM account_details ad WHERE ad.owner_id=accounts.owner_id AND ad.account_id=accounts.id) AS subtype,(SELECT crypto_tax_treatment FROM account_details ad WHERE ad.owner_id=accounts.owner_id AND ad.account_id=accounts.id) AS cryptoTaxTreatment,(SELECT terms_json FROM credit_card_terms cc WHERE cc.owner_id=accounts.owner_id AND cc.account_id=accounts.id) AS creditCardTerms,(SELECT details_json FROM manual_asset_details ma WHERE ma.owner_id=accounts.owner_id AND ma.account_id=accounts.id) AS assetDetails";
const transactionSelect = "investment_activity AS investmentActivity, id, owner_id AS ownerId, account_id AS accountId, category_id AS categoryId, date, name, amount, kind, transfer_id AS transferId, notes, import_key AS importKey, excluded, merchant_id AS merchantId, tag_ids AS tagIds, locked_fields AS lockedFields, reconciled_status AS reconciledStatus, reconciled_at AS reconciledAt, reconciled_statement_id AS reconciledStatementId";
export async function readState(owner: string): Promise<FinanceState> {
  const db = database();
  // A batch gives the client one consistent snapshot, including transfer pairs.
  const result = await db.batch([
    db.prepare("SELECT owner_id AS ownerId, name, currency, revision,market_fx AS marketFx,auto_transfer_disabled AS autoTransferDisabled FROM profiles WHERE owner_id = ?").bind(owner),
    db.prepare(`SELECT ${accountSelect} FROM accounts WHERE owner_id = ? ORDER BY archived, name`).bind(owner),
    db.prepare("SELECT id, owner_id AS ownerId, name, color, parent_id AS parentId, lucide_icon AS lucideIcon FROM categories WHERE owner_id = ? ORDER BY name").bind(owner),
    db.prepare(`SELECT ${transactionSelect} FROM transactions WHERE owner_id = ? ORDER BY date DESC, id DESC`).bind(owner),
    db.prepare("SELECT id, owner_id AS ownerId, category_id AS categoryId, month, currency, amount FROM budgets WHERE owner_id = ? ORDER BY month DESC").bind(owner),
    db.prepare("SELECT id, owner_id AS ownerId, account_id AS accountId, date, amount, name, kind FROM valuations WHERE owner_id = ? ORDER BY date DESC").bind(owner),
    db.prepare("SELECT id, owner_id AS ownerId, name, color FROM tags WHERE owner_id = ? ORDER BY name").bind(owner),
    db.prepare("SELECT id, owner_id AS ownerId, name, color, website_url AS websiteUrl FROM merchants WHERE owner_id = ? ORDER BY name").bind(owner),
    db.prepare("SELECT id, owner_id AS ownerId, transaction_id AS transactionId, position, name, amount, category_id AS categoryId, merchant_id AS merchantId, tag_ids AS tagIds, notes, kind, excluded, locked_fields AS lockedFields, reconciliation_json AS reconciliationJson FROM split_lines WHERE owner_id = ? ORDER BY transaction_id, position").bind(owner),
    db.prepare(`SELECT ${recurringSelect} FROM recurring_entries WHERE owner_id = ? ORDER BY name`).bind(owner),
    db.prepare(`SELECT ${occurrenceSelect} FROM recurring_occurrences WHERE owner_id = ? ORDER BY due_on`).bind(owner),
    db.prepare(`SELECT ${allocationSelect} FROM recurring_allocations WHERE owner_id = ?`).bind(owner),
    ...Object.entries(budgetCollections).map(([key,meta])=>db.prepare(`SELECT ${budgetSelect(key as keyof typeof budgetCollections)} FROM ${meta.table} WHERE owner_id=? ORDER BY id`).bind(owner)),
    ...Object.entries(investmentCollections).map(([key,meta])=>db.prepare(`SELECT ${investmentSelect(key as keyof typeof investmentCollections)} FROM ${meta.table} WHERE owner_id = ?`).bind(owner)),
    ...Object.entries(goalCollections).map(([key,meta])=>db.prepare(`SELECT ${goalSelect(key as keyof typeof goalCollections)} FROM ${meta.table} WHERE owner_id=? ORDER BY id`).bind(owner)),
    ...Object.entries(ruleCollections).map(([key,meta])=>db.prepare(`SELECT ${ruleSelect(key as keyof typeof ruleCollections)} FROM ${meta.table} WHERE owner_id=? ORDER BY id`).bind(owner)),
    db.prepare(`SELECT ${statementSelect} FROM account_statements WHERE owner_id=? ORDER BY period_end DESC,id`).bind(owner),
    db.prepare(`SELECT ${fileSelect} FROM statement_files WHERE owner_id=? ORDER BY created_at DESC,id`).bind(owner),
    db.prepare(`SELECT ${contributionSelect} FROM contribution_balances WHERE owner_id=? ORDER BY date DESC,id`).bind(owner),
    ...Object.entries(fxCollections).map(([key,meta])=>db.prepare(`SELECT ${fxSelect(key as FxCollection)} FROM ${meta.table} WHERE owner_id=? ORDER BY id`).bind(owner)),
    db.prepare(`SELECT ${transferRejectionSelect} FROM transfer_match_rejections WHERE owner_id=? ORDER BY created_at DESC,id`).bind(owner),
    db.prepare(`SELECT ${rejectionSelect} FROM recurring_match_rejections WHERE owner_id=? ORDER BY id`).bind(owner),
    db.prepare(`SELECT ${recurringPriceSelect} FROM recurring_price_changes WHERE owner_id=? ORDER BY effective_on DESC,id`).bind(owner),
    db.prepare("SELECT id,owner_id AS ownerId,transaction_id AS transactionId,file_id AS fileId,created_at AS createdAt FROM transaction_receipts WHERE owner_id=? ORDER BY created_at,id").bind(owner),
  ]);
  const fxData=Object.fromEntries(Object.keys(fxCollections).map((key,index)=>[key,result[30+index].results.map(value=>{const row=value as Record<string,unknown>;if(key==='transferDetails'){for(const field of ['status','createdAt','updatedAt'])if(row[field]===null)delete row[field];}return row;})])) as unknown as Pick<FinanceState,FxCollection>;
  const contributionBalances=result[29].results as unknown as FinanceState['contributionBalances'];
  const statementFiles=result[28].results as unknown as FinanceState['statementFiles'];
  const accountStatements=result[27].results.map(decodeStatement) as unknown as FinanceState['accountStatements'];
  const ruleData=Object.fromEntries(Object.keys(ruleCollections).map((key,index)=>[key,result[25+index].results.map(row=>decodeRuleRow(key as keyof typeof ruleCollections,row))])) as unknown as Pick<FinanceState,keyof typeof ruleCollections>;
  const goalData=Object.fromEntries(Object.keys(goalCollections).map((key,index)=>[key,result[21+index].results.map(row=>decodeGoalRow(key as keyof typeof goalCollections,row))])) as unknown as Pick<FinanceState,keyof typeof goalCollections>;
  const investments=Object.fromEntries(Object.keys(investmentCollections).map((key,index)=>[key,result[15+index].results.map(row=>decodeInvestmentRow(key as keyof typeof investmentCollections,row as Record<string,unknown>))])) as unknown as Pick<FinanceState,keyof typeof investmentCollections>;
  const budgetData=Object.fromEntries(Object.keys(budgetCollections).map((key,index)=>[key,result[12+index].results.map(row=>decodeBudgetRow(key as keyof typeof budgetCollections,row))])) as unknown as Pick<FinanceState,keyof typeof budgetCollections>;
  const profileRow=result[0].results[0] as unknown as Profile|undefined;if(profileRow?.autoTransferDisabled===null)delete profileRow.autoTransferDisabled;
  const state:FinanceState={ transferMatchRejections:result[result.length-4].results as unknown as FinanceState['transferMatchRejections'],recurringMatchRejections:result[result.length-3].results as unknown as FinanceState['recurringMatchRejections'],recurringPriceChanges:result[result.length-2].results as unknown as FinanceState['recurringPriceChanges'],transactionReceipts:result[result.length-1].results as unknown as FinanceState['transactionReceipts'],...fxData,contributionBalances,statementFiles,accountStatements,...ruleData,...goalData,...budgetData, ...investments, profile: profileRow ?? null, accounts: result[1].results.map(decodeAccount), categories: (result[2].results as unknown as (Omit<Category,'lucideIcon'> & {lucideIcon:string|null})[]).map(({lucideIcon,...row})=>({...row,...(lucideIcon?{lucideIcon}:{} )})) as unknown as Category[], transactions: result[3].results.map(decodeTransaction), budgets: [], valuations: result[5].results as unknown as Valuation[], tags: result[6].results as unknown as Tag[], merchants: result[7].results as unknown as Merchant[], splitLines: result[8].results.map(decodeSplit), recurringEntries: result[9].results.map(decodeRecurring), recurringOccurrences: result[10].results as unknown as RecurringOccurrence[], recurringAllocations: result[11].results.map(decodeAllocation) };
  state.budgets=legacyBudgetProjection(state);return state;
}
function decodeAccount(row: unknown):Account {
  const account = {...row as Record<string,unknown>};
  if(account.archivedOn==null)delete account.archivedOn;
  if(account.assetDetails==null)delete account.assetDetails;else account.assetDetails=normalizeAssetDetails(typeof account.assetDetails==='string'?JSON.parse(account.assetDetails):account.assetDetails,account.type as Account['type']);
  if(account.creditCardTerms==null)delete account.creditCardTerms;else account.creditCardTerms=normalizeCardTerms(typeof account.creditCardTerms==='string'?JSON.parse(account.creditCardTerms):account.creditCardTerms);
  if(account.subtype==null)delete account.subtype;
  if(account.cryptoTaxTreatment==null)delete account.cryptoTaxTreatment;
  if(account.loanReplay==null)delete account.loanReplay;
  if(account.cashPlanningExcluded==null)delete account.cashPlanningExcluded;
  if (typeof account.loanTerms === 'string') account.loanTerms = JSON.parse(account.loanTerms);
  else delete account.loanTerms;
  return account as unknown as Account;
}
async function accountFor(owner: string, id: string, active = true) {
  const account = await database().prepare(`SELECT ${accountSelect} FROM accounts WHERE owner_id = ? AND id = ?`).bind(owner, id).first<Account>();
  if (!account) throw new ApiError(404, "Account not found.");
  if (active && account.archived) throw new ApiError(400, "Restore this account before adding or changing transactions.");
  return decodeAccount(account as unknown as Record<string,unknown>);
}
async function categoryFor(owner: string, id: string | null) {
  if (!id) return;
  const found = await database().prepare("SELECT id FROM categories WHERE owner_id = ? AND id = ?").bind(owner, id).first();
  if (!found) throw new ApiError(404, "Category not found.");
}
async function transactionFor(owner: string, id: string) {
  const found = await database().prepare(`SELECT ${transactionSelect} FROM transactions WHERE owner_id = ? AND id = ?`).bind(owner, id).first<Transaction>();
  if (!found) throw new ApiError(404, "Transaction not found.");
  return decodeTransaction(found as unknown as Record<string, unknown>);
}
export function insertTransaction(owner: string, value: { investmentActivity?:Transaction['investmentActivity']; id: string; accountId: string; categoryId?: string | null; date: string; name: string; amount: number; kind: string; transferId?: string | null; notes?: string; importKey?: string | null; excluded?: boolean | number; merchantId?: string | null; tagIds?: string[];reconciledStatus?:Transaction['reconciledStatus'];reconciledAt?:string|null }) {
  return database().prepare("INSERT INTO transactions (investment_activity, id, owner_id, account_id, category_id, date, name, amount, kind, transfer_id, notes, import_key, excluded, merchant_id, tag_ids,reconciled_status,reconciled_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?,?) ON CONFLICT(owner_id, account_id, import_key) DO NOTHING")
    .bind(value.investmentActivity??null,value.id, owner, value.accountId, value.categoryId ?? null, value.date, value.name, value.amount, value.kind, value.transferId ?? null, value.notes ?? "", value.importKey ?? null, +(value.excluded ?? false), value.merchantId ?? null, JSON.stringify(value.tagIds ?? []),value.reconciledStatus??'unreconciled',value.reconciledAt??null);
}
function afterOpening(date: string, account: Account) { if (date < account.openingDate) throw new ApiError(400, `Transaction date must be on or after ${account.openingDate}, the opening date of ${account.name}.`); }
export async function executeCommand(owner: string, input: unknown, expectedRevision?:number) {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(" "));
  const c = parsed.data, db = database();
  if (c.action === "initialize") {
    if (await db.prepare("SELECT owner_id FROM profiles WHERE owner_id = ?").bind(owner).first()) throw new ApiError(409, "Your workspace already exists.");
    await db.batch([
      db.prepare("INSERT INTO profiles (owner_id, name, currency) VALUES (?, ?, ?)").bind(owner, c.name, c.currency),
      ...DEFAULT_CATEGORIES.map(([name, color]) => db.prepare("INSERT INTO categories (id, owner_id, name, color) VALUES (?, ?, ?, ?)").bind(crypto.randomUUID(), owner, name, color)),
    ]);
    return { message: "Your workspace is ready." };
  }
  const profile = await db.prepare("SELECT revision FROM profiles WHERE owner_id = ?").bind(owner).first<{ revision: number }>();
  if (!profile) throw new ApiError(409, "Create your workspace first.");
  if(expectedRevision!==undefined&&profile.revision!==expectedRevision)throw new ApiError(409,"Your workspace changed before this entry could be saved. Reload and retry.");
  const reportingResult=await executeInvestmentReporting(owner,input,profile.revision);if(reportingResult)return reportingResult;
  const repairResult=await executeInvestmentTransferRepair(owner,input,profile.revision);if(repairResult)return repairResult;
  const automaticTransferResult=await executeAutomaticTransfers(owner,input,profile.revision);if(automaticTransferResult)return automaticTransferResult;
  const classificationResult=await executeTransferClassification(owner,input,profile.revision);if(classificationResult)return classificationResult;
  const rejectionResult=await executeTransferRejection(owner,input,profile.revision);if(rejectionResult)return rejectionResult;
  const counterpartResult=await executeTransferCounterpart(owner,input,profile.revision);if(counterpartResult)return counterpartResult;
  const transferMatchResult=await executeTransferMatch(owner,input,profile.revision);if(transferMatchResult)return transferMatchResult;
  const loanReplayResult=await executeLoanReplay(owner,input,profile.revision);if(loanReplayResult)return loanReplayResult;
  const cleanupResult=await executeRecurringCleanup(owner,input,profile.revision);if(cleanupResult)return cleanupResult;
  const maintenanceResult=await executeRecurringMaintenance(owner,c,profile.revision);if(maintenanceResult)return maintenanceResult;
  const detectionResult=await executeRecurringDetection(owner,c,profile.revision);if(detectionResult)return detectionResult;
  const paycheckResult=await executePaycheckPreference(owner,c,profile.revision);if(paycheckResult)return paycheckResult;
  const lifecycleResult=await executeRecurringLifecycle(owner,c,profile.revision);if(lifecycleResult)return lifecycleResult;
  const matcherResult=await executeRecurringMatcher(owner,c,profile.revision);if(matcherResult)return matcherResult;
  const priceResult=await executeRecurringPrice(owner,c,profile.revision);if(priceResult)return priceResult;
  const marketResult=await executeMarketPricing(owner,c,profile.revision);if(marketResult)return marketResult;
  const fxResult=await executeFxCommand(owner,c,profile.revision);if(fxResult)return fxResult;
  const transferResult=await executeTransferCommand(owner,c,profile.revision);if(transferResult)return transferResult;
  const contributionResult=await executeContributionCommand(owner,c,profile.revision);if(contributionResult)return contributionResult;
  const pledgeResult=await executePledgeCommand(owner,c,profile.revision);if(pledgeResult)return pledgeResult;
  const reconciliationResult=await executeReconciliationCommand(owner,c,profile.revision);if(reconciliationResult)return reconciliationResult;
  const ruleResult=await executeRuleCommand(owner,c,profile.revision);if(ruleResult)return ruleResult;
  const goalResult=await executeGoalCommand(owner,c,profile.revision);if(goalResult)return goalResult;
  const budgetResult=await executeBudgetCommand(owner,c,profile.revision);if(budgetResult)return budgetResult;
  const investmentResult = await executeInvestmentCommand(owner,c,profile.revision);
  if(investmentResult)return investmentResult;
  const ledgerResult = await executeLedgerCommand(owner, c, profile.revision);
  if (ledgerResult) return ledgerResult;
  const apply = (statements: D1PreparedStatement[]) => commitMutation(owner, profile.revision, statements, 28);
  switch (c.action) {
    case "accountArchiveDate": {
      if(c.expectedRevision!==profile.revision)throw new ApiError(409,'The workspace changed. Reload before recording an archive date.');
      const account=await accountFor(owner,c.accountId,false);try{validateArchiveDate(c.date,!!account.archived);}catch(error){throw new ApiError(400,(error as Error).message);}
      if((account.archivedOn??null)===c.date)return {message:'This archive date is already recorded.'};
      await apply([c.date===null?db.prepare('DELETE FROM account_archive_dates WHERE owner_id=? AND account_id=?').bind(owner,c.accountId):db.prepare('INSERT INTO account_archive_dates(owner_id,account_id,archived_on) VALUES(?,?,?) ON CONFLICT(owner_id,account_id) DO UPDATE SET archived_on=excluded.archived_on').bind(owner,c.accountId,c.date)]);
      return {message:c.date?'Archive date saved.':'Archive date cleared; past archive cutoffs are now unknown.'};
    }
    case "manualAssetDetails": {
      if(c.expectedRevision!==profile.revision)throw new ApiError(409,'The workspace changed. Reload before saving asset details.');
      const account=await accountFor(owner,c.accountId,false);if(!['property','vehicle'].includes(account.type))throw new ApiError(400,'Details require a property or vehicle account.');let details;try{details=normalizeAssetDetails(c.details,account.type);}catch(error){throw new ApiError(400,(error as Error).message);}if(JSON.stringify(account.assetDetails??null)===JSON.stringify(details))return {message:'These asset details are unchanged.'};await apply(manualAssetDetailsStatements(owner,account.id,details));return {message:'Asset details saved. Recorded financial values are unchanged.'};
    }
    case "vehiclePurchase": {
      if(c.expectedRevision!==profile.revision)throw new ApiError(409,'The workspace changed. Reload the purchase correction.');const account=await accountFor(owner,c.accountId);if(account.type!=='vehicle')throw new ApiError(400,'Purchase correction requires a vehicle account.');const state=await readState(owner);if(state.profile?.revision!==c.expectedRevision)throw new ApiError(409,'The workspace changed. Reload the purchase correction.');let plan;try{plan=planVehiclePurchase(state,account.id,c.amount,c.date);}catch(error){throw new ApiError(400,(error as Error).message);}if(!plan.changed)return {message:'The recorded vehicle purchase is unchanged.'};
      const pending={...state,budgets:[],accounts:state.accounts.map(a=>a.id===account.id&&plan.opening?{...a,openingDate:plan.opening.date,openingBalance:plan.opening.amount}:a),valuations:[...state.valuations.filter(v=>v.id!==plan.anchor?.id),...(plan.anchor?[plan.anchor]:[]),...(plan.pin?[{id:'new-current-pin',ownerId:owner,accountId:account.id,kind:'reconciliation' as const,...plan.pin}]:[])]};try{validateWorkspace(pending);}catch(error){throw new ApiError(400,(error as Error).message);}const statements=[];
      const openingStatement=plan.opening?(db.prepare('UPDATE accounts SET opening_date=?,opening_balance=? WHERE owner_id=? AND id=?').bind(plan.opening.date,plan.opening.amount,owner,account.id)):null;const openingAfterAnchor=!!plan.opening&&plan.opening.date>account.openingDate;if(openingStatement&&!openingAfterAnchor)statements.push(openingStatement);
      if(plan.anchor){const v=plan.anchor;statements.push(v.id==='new-purchase-anchor'?db.prepare('INSERT INTO valuations(id,owner_id,account_id,date,amount,name,kind) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),owner,account.id,v.date,v.amount,v.name,v.kind):db.prepare('UPDATE valuations SET date=?,amount=?,name=?,kind=? WHERE owner_id=? AND id=? AND account_id=?').bind(v.date,v.amount,v.name,v.kind,owner,v.id,account.id));}
      if(openingStatement&&openingAfterAnchor)statements.push(openingStatement);
      if(plan.pin)statements.push(db.prepare("INSERT INTO valuations(id,owner_id,account_id,date,amount,name,kind) VALUES(?,?,?,?,?,?,'reconciliation')").bind(crypto.randomUUID(),owner,account.id,plan.pin.date,plan.pin.amount,plan.pin.name));await apply(statements);return {message:plan.pin?'Purchase corrected; a dated observation preserves the prior current value.':'Vehicle purchase corrected. Other activity is retained.'};
    }
    case "creditCardTerms": {
      if(c.expectedRevision!==profile.revision)throw new ApiError(409,'The workspace changed. Reload before saving card terms.');
      const account=await accountFor(owner,c.accountId,false);if(account.type!=='credit')throw new ApiError(400,'Card terms require a credit-card account.');
      const terms=normalizeCardTerms(c.terms);if(JSON.stringify(account.creditCardTerms??null)===JSON.stringify(terms))return {message:'These credit-card terms are unchanged.'};
      await apply(cardTermsStatements(owner,account.id,terms));return {message:terms?'Credit-card terms saved. Recorded balances and payments are unchanged.':'Credit-card terms removed. Recorded balances and payments are unchanged.'};
    }
    case "loanTerms": {
      if(c.expectedRevision!==profile.revision)throw new ApiError(409,"The workspace changed. Reload before saving loan terms.");
      const account=await accountFor(owner,c.accountId);
      if(account.type!=="loan")throw new ApiError(400,"Loan terms require a loan account.");
      try { if(c.terms)loanSchedule(c.terms); validateLoanReplayAccount({...account,loanTerms:c.terms}); } catch(error){throw new ApiError(400,error instanceof Error?error.message:'Invalid loan terms.');}
      await apply([db.prepare("UPDATE accounts SET loan_terms=? WHERE owner_id=? AND id=?").bind(c.terms?JSON.stringify(c.terms):null,owner,c.accountId)]);
      return {message:c.terms?"Loan terms saved.":"Loan terms removed."};
    }
    case "profile": await apply([db.prepare("UPDATE profiles SET name = ?, currency = ? WHERE owner_id = ?").bind(c.name, c.currency, owner)]); break;
    case "account": {
      if(c.expectedRevision!==undefined&&c.expectedRevision!==profile.revision)throw new ApiError(409,"The workspace changed. Reload before saving account details.");
      if(c.id&&c.type==='credit'){const old=await accountFor(owner,c.id,false);if(old.currency!==c.currency&&old.creditCardTerms&&(['availableCredit','minimumPayment','annualFee'] as const).some(key=>old.creditCardTerms![key]!==null))throw new ApiError(400,'Clear recorded card monetary terms before changing account currency.');}
      try{validateAccountDetails(c.type,c.subtype,c.cryptoTaxTreatment);}catch(error){throw new ApiError(400,(error as Error).message);}
      if(c.id){const payment=await db.prepare("SELECT MIN(json_extract(conversion,'$.sourceDate')) AS earliest FROM recurring_allocations WHERE owner_id=? AND conversion IS NOT NULL AND json_extract(conversion,'$.accountId')=?").bind(owner,c.id).first<{earliest:string|null}>();if(payment?.earliest){const old=await accountFor(owner,c.id,false);if(old.currency!==c.currency||c.openingDate>payment.earliest)throw new ApiError(400,'Payment conversion history retains this account currency and original payment dates.');}}
      if(c.id){const history=await db.prepare("SELECT MIN(date) AS earliest FROM goal_consumptions WHERE owner_id=? AND account_id=?").bind(owner,c.id).first<{earliest:string|null}>(),pledge=await db.prepare("SELECT id FROM goal_pledges WHERE owner_id=? AND account_id=? LIMIT 1").bind(owner,c.id).first();if(history?.earliest||pledge){const old=await accountFor(owner,c.id,false);if(old.currency!==c.currency||history?.earliest&&c.openingDate>history.earliest)throw new ApiError(400,"Goal usage and savings history retain this account's currency and recorded dates.");}}
      if(c.id){const statement=await db.prepare("SELECT currency,MIN(period_start) AS earliest,MAX(adjustment_type='investment_cash') AS cashAdjustment FROM account_statements WHERE owner_id=? AND account_id=? GROUP BY currency").bind(owner,c.id).first<{currency:string;earliest:string;cashAdjustment:number}>();if(statement&&(statement.currency!==c.currency||c.openingDate>statement.earliest||statement.cashAdjustment&&!['investment','crypto'].includes(c.type)))throw new ApiError(400,"Keep the statement currency and an opening date before all statement periods.");}
      if(c.id){const linked=await db.prepare("SELECT id FROM goal_accounts WHERE owner_id=? AND account_id=? LIMIT 1").bind(owner,c.id).first();if(linked){const old=await accountFor(owner,c.id,false);if(old.currency!==c.currency||!["checking","savings","investment","crypto"].includes(c.type))throw new ApiError(400,"Linked goals require this account’s current currency and a fundable account type.");}}
      if(c.id){const checkpoint=await db.prepare("SELECT MIN(date) AS earliest FROM contribution_balances WHERE owner_id=? AND account_id=?").bind(owner,c.id).first<{earliest:string|null}>();if(checkpoint?.earliest){const old=await accountFor(owner,c.id,false);if(old.currency!==c.currency||!["investment","crypto"].includes(c.type)||c.openingDate>checkpoint.earliest)throw new ApiError(400,"Keep the currency, investment type and an opening date before all contribution checkpoints.");}}
      if (c.id) {
        const old = await accountFor(owner, c.id, false);
        try{validateLoanReplayAccount({...old,type:c.type,openingBalance:c.openingBalance,openingDate:c.openingDate});}catch(error){throw new ApiError(400,(error as Error).message);}
        if(old.loanTerms&&(c.type!=="loan"||c.currency!==old.currency))throw new ApiError(400,"Remove this loan's terms before changing its type or currency.");
        const investmentDates=await db.prepare("SELECT MIN(date) AS earliest, COUNT(*) AS count FROM (SELECT date FROM trades WHERE owner_id=? AND account_id=? UNION ALL SELECT date FROM holding_snapshots WHERE owner_id=? AND account_id=? UNION ALL SELECT date FROM investment_cash_balances WHERE owner_id=? AND account_id=?)").bind(owner,c.id,owner,c.id,owner,c.id).first<{earliest:string|null;count:number}>();
        if(investmentDates?.count&&(old.currency!==c.currency||!['investment','crypto'].includes(c.type)))throw new ApiError(400,"An account with portfolio history must keep its investment type and currency.");
        if(investmentDates?.earliest&&c.openingDate>investmentDates.earliest)throw new ApiError(400,"The opening date must precede all investment history.");
        const existing = await db.prepare("SELECT MIN(date) AS earliest, COUNT(*) AS count FROM (SELECT date FROM transactions WHERE owner_id = ? AND account_id = ? UNION ALL SELECT date FROM valuations WHERE owner_id = ? AND account_id = ?)").bind(owner, c.id, owner, c.id).first<{ earliest: string | null; count: number }>();
        if (existing?.count && old.currency !== c.currency) throw new ApiError(400, "An account with transaction or balance history cannot change currency.");
        if (old.currency !== c.currency && await db.prepare("SELECT id FROM recurring_entries WHERE owner_id = ? AND (account_id = ? OR destination_account_id = ?) LIMIT 1").bind(owner, c.id, c.id).first()) throw new ApiError(400, "Detach this account from its recurring schedules before changing its currency.");
        if (existing?.earliest && c.openingDate > existing.earliest) throw new ApiError(400, "The opening date must be before all existing transaction and balance records.");
        const sameFamily=ACCOUNTABLE_TYPES[old.type]===ACCOUNTABLE_TYPES[c.type],subtype=c.subtype===undefined?(sameFamily?old.subtype:null):c.subtype,cryptoTaxTreatment=c.cryptoTaxTreatment===undefined?(sameFamily?old.cryptoTaxTreatment:null):c.cryptoTaxTreatment;
        await apply([db.prepare("UPDATE accounts SET name = ?, type = ?, currency = ?, opening_balance = ?, opening_date = ?, archived = ?, excluded_from_reports = ?, loan_replay=CASE WHEN ?='loan' THEN loan_replay ELSE NULL END WHERE owner_id = ? AND id = ?").bind(c.name, c.type, c.currency, c.openingBalance, c.openingDate, +c.archived, +c.excludedFromReports, c.type, owner, c.id),...accountDetailsStatements(owner,c.id,subtype,cryptoTaxTreatment)]);
      } else {
        const id=crypto.randomUUID();await apply([db.prepare("INSERT INTO accounts (id, owner_id, name, type, currency, opening_balance, opening_date, archived, excluded_from_reports,cash_planning_excluded) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?,?)").bind(id, owner, c.name, c.type, c.currency, c.openingBalance, c.openingDate, +c.excludedFromReports,["checking","savings"].includes(c.type)?(c.subtype==='hsa'?1:0):null),...accountDetailsStatements(owner,id,c.subtype,c.cryptoTaxTreatment)]);
      }
      break;
    }
    case "deleteAccount": {
      if(await db.prepare("SELECT id FROM recurring_allocations WHERE owner_id=? AND conversion IS NOT NULL AND json_extract(conversion,'$.accountId')=? LIMIT 1").bind(owner,c.id).first())throw new ApiError(409,'This account has payment conversion history. Archive it to retain that evidence.');
      if(await db.prepare("SELECT id FROM account_statements WHERE owner_id=? AND account_id=? LIMIT 1").bind(owner,c.id).first())throw new ApiError(409,"This account has statement history. Delete its statements first or archive the account.");
      if(await db.prepare("SELECT id FROM goal_accounts WHERE owner_id=? AND account_id=? UNION SELECT id FROM goal_consumptions WHERE owner_id=? AND account_id=? UNION SELECT id FROM goal_pledges WHERE owner_id=? AND account_id=? LIMIT 1").bind(owner,c.id,owner,c.id,owner,c.id).first())throw new ApiError(409,"This account is linked to a goal or its savings history. Archive it to preserve those records.");
      await accountFor(owner, c.id, false);
      if(await db.prepare("SELECT id FROM contribution_balances WHERE owner_id=? AND account_id=? LIMIT 1").bind(owner,c.id).first())throw new ApiError(409,"This account has contribution history. Archive it to preserve its checkpoints.");
      if (await db.prepare("SELECT id FROM recurring_entries WHERE owner_id = ? AND (account_id = ? OR destination_account_id = ?) LIMIT 1").bind(owner, c.id, c.id).first()) throw new ApiError(409, "Detach this account from its recurring entries before deleting it.");
      if(await db.prepare("SELECT id FROM trades WHERE owner_id=? AND account_id=? UNION ALL SELECT id FROM holding_snapshots WHERE owner_id=? AND account_id=? UNION ALL SELECT id FROM investment_cash_balances WHERE owner_id=? AND account_id=? LIMIT 1").bind(owner,c.id,owner,c.id,owner,c.id).first())throw new ApiError(409,"This account has investment history. Archive it to keep that history.");
      // Conditional deletion plus the FK protects against concurrent transaction creation.
      const [,result] = await apply([db.prepare("UPDATE budget_books SET account_ids = (SELECT json_group_array(value) FROM json_each(account_ids) WHERE value != ?) WHERE owner_id = ?").bind(c.id,owner), db.prepare("DELETE FROM accounts WHERE owner_id = ? AND id = ? AND NOT EXISTS (SELECT 1 FROM transactions WHERE owner_id = ? AND account_id = ?) AND NOT EXISTS (SELECT 1 FROM valuations WHERE owner_id = ? AND account_id = ?)").bind(owner, c.id, owner, c.id, owner, c.id)]);
      if (!result.meta.changes) throw new ApiError(409, "This account contains transaction or balance history. Archive it to keep that history.");
      break;
    }
    case "category": case "deleteCategory":throw new ApiError(503,"Category storage is unavailable.");
    case "transaction": {
      if(c.id){const usage=await db.prepare("SELECT COALESCE(json_extract(conversion,'$.nativeAmount'),amount) AS amount,date,account_id AS accountId FROM goal_consumptions WHERE owner_id=? AND transaction_id=?").bind(owner,c.id).first<{amount:number;date:string;accountId:string}>();if(usage&&(c.accountId!==usage.accountId||c.date!==usage.date||c.excluded||c.amount>=0||-c.amount<usage.amount))throw new ApiError(400,"This transaction backs recorded goal usage. Keep its account, date and sufficient outgoing amount, or delete it to preserve the usage without a ledger link.");}
      await metadataReferences(owner, c.merchantId, c.tagIds);
      const account = await accountFor(owner, c.accountId); afterOpening(c.date, account); await categoryFor(owner, c.categoryId);
      if (c.id) {
        const old = await transactionFor(owner, c.id);
        if (old.transferId) throw new ApiError(400, "Delete and recreate the transfer to change its recorded entries.");
        if(await db.prepare("SELECT id FROM transfer_fees WHERE owner_id=? AND transaction_id=?").bind(owner,c.id).first()&&(c.amount!==old.amount||c.accountId!==old.accountId||c.date!==old.date||c.kind!==old.kind))throw new ApiError(400,"Transfer fee amounts, dates, accounts and kinds belong to the transfer. Delete and recreate that transfer to change them.");
        if ((old.amount !== c.amount || old.date !== c.date || old.accountId !== c.accountId) && await db.prepare("SELECT id FROM recurring_allocations WHERE owner_id = ? AND transaction_id = ? LIMIT 1").bind(owner, c.id).first()) throw new ApiError(400, "Remove this transaction’s bill-payment link before changing its amount, date or account.");
        const children = await db.prepare("SELECT amount FROM split_lines WHERE owner_id = ? AND transaction_id = ?").bind(owner, c.id).all<{ amount: number }>();
        if (children.results.length && (c.amount !== old.amount || c.kind !== old.kind)) throw new ApiError(400, "Use the split editor to change the amount or reporting of a split transaction.");
        await apply([db.prepare("UPDATE transactions SET investment_activity=?, account_id = ?, category_id = ?, date = ?, name = ?, amount = ?, kind = ?, notes = ?, excluded = ?, merchant_id = ?, tag_ids = ? WHERE owner_id = ? AND id = ? AND transfer_id IS NULL").bind(c.investmentActivity===undefined?old.investmentActivity??null:c.investmentActivity,c.accountId, c.categoryId, c.date, c.name, c.amount, c.kind, c.notes, +c.excluded, c.merchantId, JSON.stringify(c.tagIds), owner, c.id)]);
      } else await apply([insertTransaction(owner, { ...c, id: crypto.randomUUID() })]);
      break;
    }
    case "deleteTransaction": {
      const old = await transactionFor(owner, c.id);
      if(await db.prepare("SELECT id FROM transfer_fees WHERE owner_id=? AND transaction_id=?").bind(owner,c.id).first())throw new ApiError(400,"Delete the parent transfer to remove this linked fee.");
      if (old.transferId&&await db.prepare("SELECT id FROM transfer_details WHERE owner_id=? AND id=? AND status='pending'").bind(owner,old.transferId).first()) {
        await apply([db.prepare('UPDATE account_statements SET review_required=1 WHERE owner_id=? AND completed_at IS NOT NULL AND EXISTS(SELECT 1 FROM transactions t WHERE t.owner_id=? AND t.transfer_id=? AND t.account_id=account_statements.account_id AND t.date<=account_statements.period_end)').bind(owner,owner,old.transferId),db.prepare('UPDATE transactions SET transfer_id=NULL WHERE owner_id=? AND transfer_id=?').bind(owner,old.transferId),db.prepare('DELETE FROM transfer_details WHERE owner_id=? AND id=?').bind(owner,old.transferId),db.prepare('UPDATE recurring_allocations SET transaction_id=NULL,split_line_id=NULL WHERE owner_id=? AND transaction_id=?').bind(owner,c.id),db.prepare('DELETE FROM transactions WHERE owner_id=? AND id=?').bind(owner,c.id)]);
      } else if (old.transferId) await apply(await transferDeleteStatements(owner,old.transferId));
      else await apply([db.prepare("UPDATE recurring_allocations SET transaction_id = NULL, split_line_id = NULL WHERE owner_id = ? AND transaction_id = ?").bind(owner, c.id), db.prepare("DELETE FROM transactions WHERE owner_id = ? AND id = ?").bind(owner, c.id)]);
      break;
    }
    case "budget": case "deleteBudget":throw new ApiError(503,"Budget storage is unavailable.");
    case "valuation": {
      const account = await accountFor(owner, c.accountId); afterOpening(c.date, account);
      if (c.id) {
        if (!await db.prepare("SELECT id FROM valuations WHERE owner_id = ? AND id = ?").bind(owner, c.id).first()) throw new ApiError(404, "Balance record not found.");
        const duplicate = await db.prepare("SELECT id FROM valuations WHERE owner_id = ? AND account_id = ? AND date = ? AND id != ?").bind(owner, c.accountId, c.date, c.id).first();
        if (duplicate) throw new ApiError(409, "There is already a balance record on this date. Edit it instead.");
        await apply([db.prepare("UPDATE valuations SET account_id = ?, date = ?, amount = ?, name = ?, kind = 'reconciliation' WHERE owner_id = ? AND id = ?").bind(c.accountId, c.date, c.amount, c.name, owner, c.id)]);
      } else await apply([db.prepare("INSERT INTO valuations (id, owner_id, account_id, date, amount, name, kind) VALUES (?, ?, ?, ?, ?, ?, 'reconciliation') ON CONFLICT(owner_id, account_id, date) DO UPDATE SET amount = excluded.amount, name = excluded.name, kind = 'reconciliation'").bind(crypto.randomUUID(), owner, c.accountId, c.date, c.amount, c.name)]);
      break;
    }
    case "deleteValuation": {
      const exists = await db.prepare("SELECT id FROM valuations WHERE owner_id = ? AND id = ?").bind(owner, c.id).first();
      if (!exists) throw new ApiError(404, "Balance record not found.");
      await apply([db.prepare("DELETE FROM valuations WHERE owner_id = ? AND id = ?").bind(owner, c.id)]); break;
    }
    case "import": {
      const account = await accountFor(owner, c.accountId);let rows:ReturnType<typeof importRows>;try{rows=importRows(c.csv,account.currency,account.name,c.csvOptions);}catch(error){throw new ApiError(400,(error as Error).message);}
      const lists = await db.batch([db.prepare("SELECT id, name FROM categories WHERE owner_id = ?").bind(owner),db.prepare("SELECT id, name FROM tags WHERE owner_id = ?").bind(owner),db.prepare("SELECT id, name FROM merchants WHERE owner_id = ?").bind(owner)]);
      const resolveName = (index: number, name: string, label: string) => {
        const rows=lists[index].results as {id:string;name:string}[],exact=rows.filter(row=>row.name===name),matches=exact.length?exact:rows.filter(row=>row.name.toLowerCase()===name.toLowerCase());
        if (matches.length!==1) throw new ApiError(400,`${matches.length?"Ambiguous":"Unknown"} ${label} “${name}”. Create a distinct matching name first or leave the column empty.`);
        return matches[0].id;
      };
      const snapshot=await readState(owner);if(snapshot.profile?.revision!==profile.revision)throw new ApiError(409,"Your workspace changed. Retry the import.");
      const occurrences = new Map<string, number>(),existing=new Set(snapshot.transactions.filter(t=>t.accountId===account.id&&t.importKey).map(t=>t.importKey)),newRows:Transaction[]=[];
      for (const row of rows) {
        afterOpening(row.date, account);
        const categoryId = row.category ? resolveName(0,row.category,"category") : null, tagIds=row.tags.map(name=>resolveName(1,name,"tag")), merchantId=row.merchant?resolveName(2,row.merchant,"merchant"):null;
        const canonical = JSON.stringify([row.date, row.name, row.amount, row.notes, row.kind]);
        const occurrence = occurrences.get(canonical) ?? 0; occurrences.set(canonical, occurrence + 1);
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${canonical}:${occurrence}`));
        const importKey = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
        if(!existing.has(importKey)){existing.add(importKey);newRows.push({id:crypto.randomUUID(),ownerId:owner,accountId:account.id,categoryId,date:row.date,name:row.name,amount:row.amount,kind:row.kind,notes:row.notes,merchantId,tagIds,excluded:+row.excluded,importKey,transferId:null,lockedFields:[],investmentActivity:row.investmentActivity,reconciledStatus:row.reconciledStatus,reconciledAt:row.reconciledStatus==='reconciled'?new Date().toISOString():null,reconciledStatementId:null});}
      }
      const template=createCSVTemplate(c.csv,c.csvOptions),mappingNotice=template?'':' Mapping was not remembered: supported mappings need at most 100 headers, each up to 2,000 characters, and 40 KB of settings.';
      if(!newRows.length){if(template)await saveDuplicateImportTemplate(owner,account.id,profile.revision,template);return {message:`Imported 0 transactions. Skipped ${rows.length} previously imported rows.${mappingNotice}`};}
      const pending={...snapshot,transactions:snapshot.transactions.concat(newRows)};let result:ReturnType<typeof evaluateRules>;try{result=evaluateRules(pending,{scope:{transactionIds:newRows.map(t=>t.id)}});validateWorkspace(ruleValidationWorkspace(result,'csv'));}catch(error){throw new ApiError(400,(error as Error).message);}
      await commitMutation(owner,profile.revision,[...newRows.map(row=>insertTransaction(owner,row)),...ruleResultStatements(owner,pending,result,'csv'),...(template?[csvTemplateStatement(owner,account.id,template)]:[])],22);
      return { message: `Imported ${newRows.length} transactions. Skipped ${rows.length-newRows.length} previously imported rows.${result.summary.length?` Rules updated ${result.changedTransactions} new transactions.`:''}${mappingNotice}` };
    }
  }
  return { message: "Saved successfully." };
}
