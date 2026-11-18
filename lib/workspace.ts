import {MAX_WORKSPACE_RECORDS} from './workspace-limits.ts';
import {manualAssetDetailsSchema,normalizeAssetDetails} from './manual-asset-schema.ts';
import {creditCardTermsSchema,normalizeCardTerms} from './credit-card-schema.ts';
import {CRYPTO_TAX_TREATMENTS,validSubtype,validateAccountDetails} from './account-details.ts';
import {categoryIconSchema} from './category-schema.ts';
import {investmentActivitySchema} from './investment-reporting-schema.ts';
import {transactionLocksSchema} from './rule-schema.ts';
import {transferRejectionFields} from './transfer-rejection-schema.ts';
import type {Account} from './finance.ts';
import {validateLoanReplayAccount} from './loan-replay-report.ts';
import {recurringObservationFields} from './recurring-observations.ts';
import {lifecycleDates} from "./recurring-lifecycle-schema.ts";
import {recurringMatcherSettingsSchema,recurringMatchRejectionFields,matcherJSON} from "./recurring-matcher-schema.ts";
import {validateMatcherWorkspace} from "./recurring-matcher.ts";
import {recurringPriceFields} from "./recurring-price-schema.ts";
import {validateRecurringPrices} from "./recurring-prices.ts";
import {loanTermsSchema} from "./loan-schema.ts";
import {loanSchedule} from "./loans.ts";
import type {InvestmentFxReview} from './sure-import-fx.ts';
import {validateTransactionReceipts} from './receipt-validation.ts';
import {paymentConversionSchema,validateRecurringPayments} from './recurring-fx.ts';
import {exchangeRateFields,transferDetailFields,transferFeeFields} from './fx-schema.ts';
import {validateFx} from './fx.ts';
import {contributionBalanceFields} from './contribution-schema.ts';
import {validateContributionBalances} from './contributions.ts';
import {pledgeFields} from './pledge-schema.ts';
import {validatePledges} from './pledges.ts';
import {statementFileFields,validateFileMetadata} from './statement-file-schema.ts';
import {statementFields,reconciliationTransactionFields,splitReconciliationSchema} from './reconciliation-schema.ts';
import {validateReconciliation} from './reconciliation.ts';
import {ruleFields,ruleRunFields,ruleLocksSchema} from './rule-schema.ts';
import {validateRules} from './rules.ts';
import {goalFields,goalAccountFields,goalConsumptionFields} from './goal-schema.ts';
import {validateGoals} from './goals.ts';
import {budgetBookFields,budgetPeriodFields,budgetEnvelopeFields} from "./budget-schema.ts";
import {legacyBudgetProjection,normalizeLegacyBudgets} from "./budget.ts";
import {validateBudgetWorkspace} from "./budget-workspace.ts";
import {securityFields,priceFields,tradeFields,holdingFields,splitFields as securitySplitFields,cashBalanceFields} from "./investment-schema.ts";
import {validateInvestmentWorkspace} from "./investment-workspace.ts";
import { z } from "zod";
import { ledgerAmount, ledgerColor, ledgerDate, recurringFields, splitFields, tagIdsSchema, websiteSchema } from "./ledger-schema.ts";
import { validateRecurringEntry } from "./recurring.ts";
import { isValuationOnlyType, ACCOUNT_TYPES, BUDGET_EXCLUDED_KINDS, CURRENCIES, KINDS, accountBalance, liability, reportingTransactions, sumMinorUnits, today,validDate, type FinanceState } from "./finance.ts";

const key = z.string().min(1).max(160);
const amount = z.number().int().safe().min(-1_000_000_000_000).max(1_000_000_000_000);
const currency = z.enum(CURRENCIES);
const date = z.string().refine(validDate, "Invalid calendar date.");
const text = z.string().trim().min(1).max(160);
const binary = z.union([z.literal(0), z.literal(1)]);
const category = z.object({ lucideIcon:categoryIconSchema.optional(), id: key, name: text.max(80), color: z.string().regex(/^#[\da-fA-F]{6}$/), parentId: key.nullable().default(null) });
const account = z.object({ assetDetails:manualAssetDetailsSchema.nullable().optional(), creditCardTerms:creditCardTermsSchema.nullable().optional(), subtype:z.string().refine(validSubtype).nullable().optional(),cryptoTaxTreatment:z.enum(CRYPTO_TAX_TREATMENTS).nullable().optional(), archivedOn:date.nullable().optional(), loanReplay:binary.nullable().optional(),cashPlanningExcluded:binary.nullable().optional(),loanTerms:loanTermsSchema.nullable().optional(),id: key, name: text, type: z.enum(ACCOUNT_TYPES), currency, openingBalance: amount, openingDate: date, archived: binary.default(0), excludedFromReports: binary.default(0) });
const transaction = z.object({ investmentActivity:investmentActivitySchema, ...reconciliationTransactionFields, lockedFields:transactionLocksSchema, id: key, accountId: key, categoryId: key.nullable(), date, name: text, amount, kind: z.enum(KINDS), transferId: key.nullable(), notes: z.string().max(2000).default(""), importKey: z.string().max(256).nullable().default(null), excluded: binary.default(0), merchantId: key.nullable().default(null), tagIds: tagIdsSchema });
const valuation = z.object({ id: key, accountId: key, date, amount, name: text, kind: z.enum(["reconciliation", "opening_anchor", "current_anchor", "history"]) });
const budget = z.object({ id: key, categoryId: key, month: z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/), currency, amount: amount.refine(n => n > 0, "Budget must be positive.") });
const tag = z.object({ id: key, name: text.max(80), color: ledgerColor });
const merchant = z.object({ id: key, name: text, color: ledgerColor, websiteUrl: websiteSchema });
const split = z.object({ reconciliation:splitReconciliationSchema.optional(), lockedFields:ruleLocksSchema, id: key, transactionId: key, position: z.number().int().min(0).max(99), ...splitFields });
const recurring = z.object({ ...recurringObservationFields,manual:binary.nullable().optional(),renewsOn:lifecycleDates.renewsOn.optional(),trialEndsOn:lifecycleDates.trialEndsOn.optional(),cancelledOn:lifecycleDates.cancelledOn.optional(),matching:recurringMatcherSettingsSchema.nullable().optional(),id: key, ...recurringFields });
const occurrence = z.object({ id: key, recurringEntryId: key, originalDueOn: ledgerDate, dueOn: ledgerDate, currency, expectedAmount: ledgerAmount.refine(n => n >= 0).nullable().default(null), status: z.enum(["scheduled", "paid", "skipped", "missed"]), snoozedUntil: ledgerDate.nullable().default(null), closedAt: z.string().max(100).nullable().default(null), closedSource: z.string().max(160).nullable().default(null), notes: z.string().max(2000).default("") });
const allocation = z.object({ matchConfidence:z.number().int().min(0).max(10000).nullable().optional(),matchSignals:matcherJSON.nullable().optional(), conversion:paymentConversionSchema.nullable().default(null),requestFingerprint:z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null), id: key, occurrenceId: key, transactionId: key.nullable(), splitLineId: key.nullable().default(null), amount: ledgerAmount.refine(n => n > 0), currency, sourceAmount: ledgerAmount.refine(n => n >= 0).nullable().default(null), sourceCurrency: currency.nullable().default(null), state: z.enum(["suggested", "confirmed"]), source: z.enum(["auto_matched", "user_confirmed", "user_created"]), paidOn: ledgerDate.nullable().default(null) });
export const workspaceSchema = z.object({
 transferMatchRejections:z.array(z.object({id:key,...transferRejectionFields})).max(10000).default([]),
 recurringMatchRejections:z.array(z.object({id:key,...recurringMatchRejectionFields})).max(10000).default([]),
 recurringPriceChanges:z.array(z.object({id:key,...recurringPriceFields})).max(5000).default([]),
 exchangeRates:z.array(z.object({id:key,...exchangeRateFields})).max(20000).default([]),transferDetails:z.array(z.object({id:key,...transferDetailFields})).max(10000).default([]),transferFees:z.array(z.object({id:key,...transferFeeFields})).max(20000).default([]),
 contributionBalances:z.array(z.object({id:key,...contributionBalanceFields})).max(20000).default([]),
 goalPledges:z.array(z.object({id:key,...pledgeFields})).max(5000).default([]),
 transactionReceipts:z.array(z.object({id:key,transactionId:key,fileId:key,createdAt:z.string().datetime()})).max(5000).default([]),
 statementFiles:z.array(z.object({id:key,...statementFileFields})).max(500).default([]),
 accountStatements:z.array(z.object({id:key,...statementFields})).max(5000).default([]),
 rules:z.array(z.object({id:key,...ruleFields})).max(500).default([]),ruleRuns:z.array(z.object({id:key,...ruleRunFields})).max(100).default([]),
 goals:z.array(z.object({id:key,...goalFields})).max(500).default([]),goalAccounts:z.array(z.object({id:key,...goalAccountFields})).max(10000).default([]),goalConsumptions:z.array(z.object({id:key,...goalConsumptionFields})).max(20000).default([]),
 budgetBooks:z.array(z.object({id:key,...budgetBookFields})).max(500).default([]),budgetPeriods:z.array(z.object({id:key,...budgetPeriodFields})).max(5000).default([]),budgetEnvelopes:z.array(z.object({id:key,...budgetEnvelopeFields})).max(20000).default([]),
  securities:z.array(z.object({id:key,...securityFields})).max(5000).default([]),securityPrices:z.array(z.object({id:key,...priceFields})).max(20000).default([]),trades:z.array(z.object({id:key,...tradeFields})).max(20000).default([]),holdingSnapshots:z.array(z.object({id:key,...holdingFields})).max(20000).default([]),securitySplits:z.array(z.object({id:key,...securitySplitFields})).max(20000).default([]),investmentCashBalances:z.array(z.object({id:key,...cashBalanceFields})).max(20000).default([]),
  profile: z.object({ autoTransferDisabled:binary.nullable().optional(),marketFx:binary.default(0),name: text, currency }),
  accounts: z.array(account).max(500), categories: z.array(category).max(2000),
  tags: z.array(tag).max(2000).default([]), merchants: z.array(merchant).max(5000).default([]), splitLines: z.array(split).max(20000).default([]), recurringEntries: z.array(recurring).max(500).default([]), recurringOccurrences: z.array(occurrence).max(20000).default([]), recurringAllocations: z.array(allocation).max(20000).default([]),
  transactions: z.array(transaction).max(20000), valuations: z.array(valuation).max(20000).default([]), budgets: z.array(budget).max(10000),
});
export type WorkspaceData = z.infer<typeof workspaceSchema>;
export interface MigrationResult { data: WorkspaceData; warnings: string[]; source: "sites" | "sure"; sourceCounts?: Record<string, number>; investmentFx?:InvestmentFxReview; }
export const MAX_IMPORT_BYTES = 8_000_000;
export function validateWorkspace(input: unknown): WorkspaceData {
  const result = workspaceSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues.slice(0, 5).map(i => `${i.path.join(".")}: ${i.message}`).join(" ");
    throw new Error(first);
  }
  const value = result.data;
  for(const account of value.accounts)validateLoanReplayAccount(account as Account);
  for(const account of value.accounts){const details=normalizeAssetDetails(account.assetDetails,account.type);if(details)account.assetDetails=details;else delete account.assetDetails;if(account.archivedOn==null)delete account.archivedOn;if(account.subtype==null)delete account.subtype;if(account.cryptoTaxTreatment==null)delete account.cryptoTaxTreatment;validateAccountDetails(account.type,account.subtype,account.cryptoTaxTreatment);const terms=normalizeCardTerms(account.creditCardTerms);if(terms&&account.type!=='credit')throw new Error('Card terms require a credit-card account.');if(terms)account.creditCardTerms=terms;else delete account.creditCardTerms;}
  for(const account of value.accounts)if(account.archivedOn!=null&&(!account.archived||account.archivedOn>today()))throw new Error("Archive dates require an archived account and a date through today.");
  for(const account of value.accounts)if(account.loanReplay!=null&&account.type!=="loan")throw new Error("Loan replay preferences require a loan account.");
  for(const account of value.accounts)if(account.loanTerms){if(account.type!=="loan")throw new Error("Loan terms require a loan account.");loanSchedule(account.loanTerms);}
  if (Object.entries(value).filter(([key]) => key !== "profile").reduce((sum, [, rows]) => sum + (Array.isArray(rows) ? rows.length : 0), 0) > MAX_WORKSPACE_RECORDS) throw new Error("This import exceeds 20,000 records. Larger migrations need to be split before importing.");
  const unique = <T extends { id: string }>(items: T[], label: string) => {
    const map = new Map(items.map(item => [item.id, item]));
    if (map.size !== items.length) throw new Error(`Duplicate ${label} identifiers.`);
    return map;
  };
  const accounts = unique(value.accounts, "account"), categories = unique(value.categories, "category");
  const transactions = unique(value.transactions, "transaction"); unique(value.valuations, "valuation"); unique(value.budgets, "budget");
  const tags = unique(value.tags, "tag"), merchants = unique(value.merchants, "merchant"), splits = unique(value.splitLines, "split line"), series = unique(value.recurringEntries, "recurring entry"), occurrences = unique(value.recurringOccurrences, "recurring occurrence");
  unique(value.transferMatchRejections,'transfer match rejection');
  const rejectedPairs=new Set<string>();for(const r of value.transferMatchRejections){const pair=JSON.stringify([r.outflowTransactionId,r.inflowTransactionId]);if(r.outflowTransactionId===r.inflowTransactionId||!transactions.has(r.outflowTransactionId)||!transactions.has(r.inflowTransactionId)||rejectedPairs.has(pair))throw new Error('Transfer dismissals need two distinct existing transactions and a unique ordered pair.');rejectedPairs.add(pair);}
  unique(value.recurringMatchRejections,"recurring match rejection");
  unique(value.recurringAllocations, "recurring allocation"); unique(value.recurringPriceChanges,"recurring price change");
  if (new Set(value.tags.map(t => t.name)).size !== value.tags.length) throw new Error("Duplicate tag names.");
  const references = (row: { categoryId?: string | null; merchantId?: string | null; tagIds?: string[] }) => {
    if (row.categoryId && !categories.has(row.categoryId)) throw new Error("Missing category reference.");
    if (row.merchantId && !merchants.has(row.merchantId)) throw new Error("Missing merchant reference.");
    if (row.tagIds?.some(id => !tags.has(id))) throw new Error("Missing tag reference.");
  };
  const categoryNames = new Set<string>();
  for (const category of categories.values()) {
    if (categoryNames.has(category.name)) throw new Error(`Duplicate category name: ${category.name}.`);
    categoryNames.add(category.name);
    const seen = new Set([category.id]); let parent = category.parentId;
    while (parent) {
      if (!categories.has(parent)) throw new Error(`Missing parent category for ${category.name}.`);
      if (seen.has(parent) || seen.size >= 10) throw new Error("Category hierarchy contains a cycle or exceeds ten levels.");
      seen.add(parent); parent = categories.get(parent)!.parentId;
    }
  }
  const transfers = new Map<string, WorkspaceData["transactions"]>();
  const imports = new Set<string>();
  for (const entry of value.transactions) {
    references(entry);
    const account = accounts.get(entry.accountId);
    if (!account) throw new Error(`Missing account for transaction ${entry.name}.`);
    if (entry.date < account.openingDate) throw new Error(`Transaction ${entry.name} predates its account opening date.`);
    if (entry.categoryId && !categories.has(entry.categoryId)) throw new Error(`Missing category for transaction ${entry.name}.`);
    if (entry.importKey) {
      const key = JSON.stringify([entry.accountId, entry.importKey]);
      if (imports.has(key)) throw new Error("Duplicate imported transaction key.");
      imports.add(key);
    }
    if (entry.transferId) {
      const group = transfers.get(entry.transferId) ?? []; group.push(entry); transfers.set(entry.transferId, group);
    }
  }
  for (const legs of transfers.values()) {
    if (legs.length !== 2 || legs[0].amount===0 || legs[1].amount===0 || Math.sign(legs[0].amount)===Math.sign(legs[1].amount) || legs[0].accountId === legs[1].accountId || (accounts.get(legs[0].accountId)!.currency === accounts.get(legs[1].accountId)!.currency && legs[0].amount + legs[1].amount !== 0)) throw new Error("Transfers must contain two equal and opposite entries in different accounts of the same currency.");
    // A transfer association does not erase a saved standard/one-time kind or legacy kind drift.
    // Physical pairing and applied snapshots remain mandatory; reporting repair is explicit.
  }
  validateFx(workspaceState(value));
  const splitGroups = new Map<string, typeof value.splitLines>();
  for (const line of value.splitLines) {
    references(line); const parent = transactions.get(line.transactionId);
    if (!parent || parent.transferId) throw new Error("Split lines need a non-transfer parent transaction.");
    const group = splitGroups.get(parent.id) ?? []; group.push(line); splitGroups.set(parent.id, group);
  }
  for (const [id, lines] of splitGroups) if (lines.length < 2 || lines.length > 100 || new Set(lines.map(l => l.position)).size !== lines.length || sumMinorUnits(lines.map(l => l.amount)) !== transactions.get(id)!.amount) throw new Error("Split lines must have unique positions and add up to their parent total.");
  for (const entry of value.recurringEntries) {
    references(entry); validateRecurringEntry(entry);
    for (const id of [entry.accountId, entry.destinationAccountId]) if (id && !accounts.has(id)) throw new Error("A recurring entry has a missing account.");
    if (entry.expectedAmountMin !== null && entry.expectedAmountMax !== null && entry.expectedAmountMin > entry.expectedAmountMax) throw new Error("Expected minimum exceeds maximum.");
  }
  const occurrenceKeys = new Set<string>();
  for (const entry of value.recurringOccurrences) {
    if (!series.has(entry.recurringEntryId) || series.get(entry.recurringEntryId)!.currency !== entry.currency) throw new Error("A recurring occurrence has a missing schedule or different currency.");
    const key = JSON.stringify([entry.recurringEntryId, entry.originalDueOn]); if (occurrenceKeys.has(key)) throw new Error("Duplicate recurring occurrence identity."); occurrenceKeys.add(key);
  }
  for (const allocation of value.recurringAllocations) {
    const occurrence = occurrences.get(allocation.occurrenceId);
    if (!occurrence || occurrence.currency !== allocation.currency) throw new Error("A payment has a missing occurrence or different currency.");
    if (allocation.transactionId && !transactions.has(allocation.transactionId)) throw new Error("A payment references a missing transaction.");
    if (allocation.splitLineId && (!allocation.transactionId || splits.get(allocation.splitLineId)?.transactionId !== allocation.transactionId)) throw new Error("A payment references an unrelated split line.");
  }
  validateRecurringPayments(workspaceState(value));
  const valuationDates = new Set<string>();
  for (const entry of value.valuations) {
    const account = accounts.get(entry.accountId), key = JSON.stringify([entry.accountId, entry.date]);
    if (!account || entry.date < account.openingDate) throw new Error("Balance record has a missing account or predates its opening date.");
    if (valuationDates.has(key)) throw new Error("An account has two balance records on the same date.");
    valuationDates.add(key);
  }
  const budgetKeys = new Set<string>();
  for (const entry of value.budgets) {
    if (!categories.has(entry.categoryId)) throw new Error("A budget references a missing category.");
    const key = JSON.stringify([entry.month, entry.currency, entry.categoryId]);
    if (budgetKeys.has(key)) throw new Error("Duplicate category budget for the same currency and month.");
    budgetKeys.add(key);
  }
  // Check complete dated ledgers in exact arithmetic, including scheduled entries.
  // Otherwise individually valid numbers could overflow a report after restore.
  const limit = BigInt(Number.MAX_SAFE_INTEGER), zero = BigInt(0);
  const events = new Map<string, Map<string, { flow: bigint; snapshot?: number }>>();
  const event = (date: string, accountId: string) => {
    const day = events.get(date) ?? new Map(); events.set(date, day);
    const value = day.get(accountId) ?? { flow: zero }; day.set(accountId, value); return value;
  };
  for (const account of value.accounts) event(account.openingDate, account.id);
  const reports = new Map<string, { income: bigint; expenses: bigint }>();
  for (const entry of value.transactions) {
    event(entry.date, entry.accountId).flow += BigInt(entry.amount);
  }
  for (const entry of reportingTransactions(workspaceState(value))) {
    const account = accounts.get(entry.accountId)!;
    if (!entry.excluded && !account.excludedFromReports && !BUDGET_EXCLUDED_KINDS.includes(entry.kind)) {
      const key = `${account.currency}:${entry.date.slice(0, 7)}`, totals = reports.get(key) ?? { income: zero, expenses: zero };
      if (entry.amount > 0) totals.income += BigInt(entry.amount); else totals.expenses -= BigInt(entry.amount);
      if (totals.income > limit || totals.expenses > limit) throw new Error("A monthly report exceeds the supported integer range.");
      reports.set(key, totals);
    }
  }
  for (const entry of value.valuations) event(entry.date, entry.accountId).snapshot = entry.amount;
  const running = new Map<string, bigint>(), currencies = new Map<string, bigint>();
  for (const [date, day] of [...events].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [accountId, entry] of day) {
      const account = accounts.get(accountId)!, prior = running.get(accountId) ?? zero;
      const base = date === account.openingDate ? BigInt(account.openingBalance) : prior;
      const next = entry.snapshot !== undefined ? BigInt(entry.snapshot) : base + (isValuationOnlyType(account.type) ? zero : entry.flow);
      if (next > limit || next < -limit) throw new Error("An account balance exceeds the supported integer range.");
      running.set(accountId, next);
      if (!account.excludedFromReports) {
        currencies.set(account.currency, (currencies.get(account.currency) ?? zero) + next - prior);
        const side = `${account.currency}:${liability(account.type) ? "liabilities" : "assets"}`;
        currencies.set(side, (currencies.get(side) ?? zero) + next - prior);
      }
    }
    if ([...currencies.values()].some(value => value > limit || value < -limit)) throw new Error("A net-worth total exceeds the supported integer range.");
  }
  const normalizedBudgets=normalizeLegacyBudgets(workspaceState(value));value.budgetBooks=normalizedBudgets.budgetBooks.map(({ownerId,...row})=>row);value.budgetPeriods=normalizedBudgets.budgetPeriods.map(({ownerId,...row})=>row);value.budgetEnvelopes=normalizedBudgets.budgetEnvelopes.map(({ownerId,...row})=>row);value.budgets=[];
  if(Object.values(value).reduce((n,v)=>n+(Array.isArray(v)?v.length:0),0)>MAX_WORKSPACE_RECORDS)throw new Error("This import exceeds 20,000 records after upgrading its budgets.");
  validateTransactionReceipts(value);
  validateFileMetadata(value.statementFiles,new Set(value.accountStatements.map(s=>s.id)));
  validateReconciliation(workspaceState(value));
  validateRules(workspaceState(value));
  validateContributionBalances(workspaceState(value));
  validateGoals(workspaceState(value));
  validatePledges(workspaceState(value));
  validateBudgetWorkspace(workspaceState(value));
  validateMatcherWorkspace(workspaceState(value));
  validateRecurringPrices(workspaceState(value));
  validateInvestmentWorkspace(workspaceState(value));
  return value;
}
export function parseSitesBackup(content: string): MigrationResult {
  let source: unknown; try { source = JSON.parse(content); } catch { throw new Error("This file is not valid JSON."); }
  const envelope = z.object({ format: z.literal("sure-sites"), version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8),z.literal(9),z.literal(10),z.literal(11),z.literal(12),z.literal(13),z.literal(14),z.literal(15),z.literal(16),z.literal(17),z.literal(18),z.literal(19),z.literal(20),z.literal(21),z.literal(22),z.literal(23),z.literal(24),z.literal(25),z.literal(26),z.literal(27),z.literal(28),z.literal(29),z.literal(30),z.literal(31),z.literal(32),z.literal(33),z.literal(34),z.literal(35),z.literal(36)]) }).safeParse(source);
  if (!envelope.success) throw new Error("Choose a Sure Sites financial backup in format version 1 through 36.");
  return { data: validateWorkspace(source), warnings: [], source: "sites" };
}
export function workspaceState(data: WorkspaceData): FinanceState {
  const ownerId = "preview";
  return { transferMatchRejections:data.transferMatchRejections.map(r=>({...r,ownerId})),recurringMatchRejections:data.recurringMatchRejections.map(r=>({...r,ownerId})),recurringPriceChanges:data.recurringPriceChanges.map(p=>({...p,ownerId})),transactionReceipts:data.transactionReceipts.map(r=>({...r,ownerId})),exchangeRates:data.exchangeRates.map(r=>({...r,ownerId})),transferDetails:data.transferDetails.map(d=>({...d,ownerId})),transferFees:data.transferFees.map(f=>({...f,ownerId})),contributionBalances:data.contributionBalances.map(b=>({...b,ownerId})),goalPledges:data.goalPledges.map(p=>({...p,ownerId})),statementFiles:data.statementFiles.map(f=>({...f,ownerId})),accountStatements:data.accountStatements.map(s=>({...s,ownerId})),rules:data.rules.map(r=>({...r,ownerId})),ruleRuns:data.ruleRuns.map(r=>({...r,ownerId})),goals:data.goals.map(g=>({...g,ownerId})),goalAccounts:data.goalAccounts.map(l=>({...l,ownerId})),goalConsumptions:data.goalConsumptions.map(c=>({...c,ownerId})),budgetBooks:data.budgetBooks.map(b=>({...b,ownerId})),budgetPeriods:data.budgetPeriods.map(p=>({...p,ownerId})),budgetEnvelopes:data.budgetEnvelopes.map(e=>({...e,ownerId})), securities:data.securities.map(s=>({...s,ownerId})),securityPrices:data.securityPrices.map(p=>({...p,ownerId})),trades:data.trades.map(t=>({...t,ownerId})),holdingSnapshots:data.holdingSnapshots.map(h=>({...h,ownerId})),securitySplits:data.securitySplits.map(s=>({...s,ownerId})),investmentCashBalances:data.investmentCashBalances.map(b=>({...b,ownerId})), profile: { ...data.profile, ownerId, revision: 0 }, accounts: data.accounts.map(a => ({ ...a, ownerId })), categories: data.categories.map(c => ({ ...c, ownerId })), transactions: data.transactions.map(t => ({ ...t, ownerId })), valuations: data.valuations.map(v => ({ ...v, ownerId })), budgets: data.budgets.map(b => ({ ...b, ownerId })), tags: data.tags.map(t => ({ ...t, ownerId })), merchants: data.merchants.map(m => ({ ...m, ownerId })), splitLines: data.splitLines.map(l => ({ ...l, ownerId })), recurringEntries: data.recurringEntries.map(r => ({ ...r, ownerId })), recurringOccurrences: data.recurringOccurrences.map(o => ({ ...o, ownerId })), recurringAllocations: data.recurringAllocations.map(a => ({ ...a, ownerId })) };
}
export function workspaceSummary(data: WorkspaceData, asOf: string) {
  const state = workspaceState(data);
  return {
    counts: { transferMatchRejections:data.transferMatchRejections.length,recurringMatchRejections:data.recurringMatchRejections.length,recurringPriceChanges:data.recurringPriceChanges.length,transactionReceipts:data.transactionReceipts.length,exchangeRates:data.exchangeRates.length,transferDetails:data.transferDetails.length,transferFees:data.transferFees.length,contributionBalances:data.contributionBalances.length,goalPledges:data.goalPledges.length,statementFiles:data.statementFiles.length,accountStatements:data.accountStatements.length,rules:data.rules.length,ruleRuns:data.ruleRuns.length,goals:data.goals.length,goalAccounts:data.goalAccounts.length,goalConsumptions:data.goalConsumptions.length,budgetBooks:data.budgetBooks.length,budgetPeriods:data.budgetPeriods.length,budgetEnvelopes:data.budgetEnvelopes.length, securities:data.securities.length,securityPrices:data.securityPrices.length,trades:data.trades.length,holdingSnapshots:data.holdingSnapshots.length,securitySplits:data.securitySplits.length,investmentCashBalances:data.investmentCashBalances.length, accounts: data.accounts.length, categories: data.categories.length, transactions: data.transactions.length, transferPairs: new Set(data.transactions.flatMap(t => t.transferId ? [t.transferId] : [])).size, valuations: data.valuations.length, budgets: legacyBudgetProjection(state).length, tags: data.tags.length, merchants: data.merchants.length, splitLines: data.splitLines.length, recurringEntries: data.recurringEntries.length, recurringOccurrences: data.recurringOccurrences.length, recurringAllocations: data.recurringAllocations.length },
    balances: data.accounts.map(account => ({ name: account.name, currency: account.currency, amount: accountBalance({ ...account, ownerId: "preview" }, state, asOf) })),
    loanReview: data.accounts.filter(a=>a.loanTerms).map(a=>({name:a.name,currency:a.currency,terms:a.loanTerms!,replay:a.loanReplay??null})),
    asOf,
  };
}
export function remapWorkspace(data: WorkspaceData): WorkspaceData {
  const fresh = (rows: { id: string }[]) => new Map(rows.map(row => [row.id, crypto.randomUUID()]));
  const accounts = fresh(data.accounts), categories = fresh(data.categories), transfers = new Map([...new Set(data.transactions.flatMap(t => t.transferId ? [t.transferId] : []))].map(id => [id, crypto.randomUUID()]));
  const files=fresh(data.statementFiles),statements=fresh(data.accountStatements),valuations=fresh(data.valuations),cashBalances=fresh(data.investmentCashBalances);
  for(const s of data.accountStatements)if(s.adjustmentId){const map=s.adjustmentType==='valuation'?valuations:cashBalances;if(!map.has(s.adjustmentId))map.set(s.adjustmentId,crypto.randomUUID());}
  const goals=fresh(data.goals);
  const budgetBooks=fresh(data.budgetBooks),budgetPeriods=fresh(data.budgetPeriods);
  const securities=fresh(data.securities);
  const tags = fresh(data.tags), merchants = fresh(data.merchants), transactions = fresh(data.transactions), splits = fresh(data.splitLines), recurring = fresh(data.recurringEntries), occurrences = fresh(data.recurringOccurrences);
  const metadata = (row: { tagIds: string[]; merchantId: string | null }) => ({ tagIds: row.tagIds.map(id => tags.get(id)!), merchantId: row.merchantId ? merchants.get(row.merchantId)! : null });
  const reference=(field:string,value:string|null)=>value?({categoryId:categories,merchantId:merchants,tagIds:tags,accountId:accounts} as Record<string,Map<string,string>>)[field]?.get(value)??value:null;
  const remapLeaf=(c:WorkspaceData['rules'][number]['conditions'][number])=>c.field==='group'?{...c,conditions:c.conditions.map(l=>({...l,value:reference(l.field,l.value)??''}))}:{...c,value:reference(c.field,c.value)??''};
  return { profile: data.profile,
    transferMatchRejections:data.transferMatchRejections.map(r=>({...r,id:crypto.randomUUID(),outflowTransactionId:transactions.get(r.outflowTransactionId)!,inflowTransactionId:transactions.get(r.inflowTransactionId)!})),
    recurringMatchRejections:data.recurringMatchRejections.map(r=>({...r,id:crypto.randomUUID(),recurringEntryId:recurring.get(r.recurringEntryId)!,transactionId:transactions.get(r.transactionId)!,splitLineId:r.splitLineId?splits.get(r.splitLineId)!:null})),
    recurringPriceChanges:data.recurringPriceChanges.map(p=>({...p,id:crypto.randomUUID(),recurringEntryId:recurring.get(p.recurringEntryId)!,transactionId:p.transactionId?transactions.get(p.transactionId)!:null})),
    exchangeRates:data.exchangeRates.map(r=>({...r,id:crypto.randomUUID()})),transferDetails:data.transferDetails.map(d=>({...d,id:transfers.get(d.id)!,requestId:null,requestFingerprint:null})),transferFees:data.transferFees.map(f=>({...f,id:crypto.randomUUID(),transferId:transfers.get(f.transferId)!,transactionId:transactions.get(f.transactionId)!})),
    contributionBalances:data.contributionBalances.map(b=>({...b,id:crypto.randomUUID(),accountId:accounts.get(b.accountId)!})),
    goalPledges:data.goalPledges.map(p=>({...p,id:crypto.randomUUID(),matchedEventId:p.matchedEventId?crypto.randomUUID():null,goalId:goals.get(p.goalId)!,accountId:accounts.get(p.accountId)!,matchedTransactionId:p.matchedTransactionId?transactions.get(p.matchedTransactionId)!:null,matchedValuationId:p.matchedValuationId?valuations.get(p.matchedValuationId)!:null})),
    transactionReceipts:data.transactionReceipts.map(r=>({...r,id:crypto.randomUUID(),transactionId:transactions.get(r.transactionId)!,fileId:files.get(r.fileId)!})),
    statementFiles:data.statementFiles.map(f=>({...f,id:files.get(f.id)!,statementId:f.statementId?statements.get(f.statementId)!:null,uploadStatus:'missing'})),
    accountStatements:data.accountStatements.map(s=>{const map=s.adjustmentType==='valuation'?valuations:cashBalances,remapSnapshot=(snap:typeof s.adjustmentAfter)=>snap?{...snap,id:map.get(snap.id)!,accountId:accounts.get(snap.accountId)!}:null;return {...s,id:statements.get(s.id)!,accountId:accounts.get(s.accountId)!,adjustmentId:s.adjustmentId?map.get(s.adjustmentId)!:null,adjustmentBefore:remapSnapshot(s.adjustmentBefore),adjustmentAfter:remapSnapshot(s.adjustmentAfter)};}),
    rules:data.rules.map(r=>({...r,id:crypto.randomUUID(),conditions:r.conditions.map(remapLeaf),actions:r.actions.map(a=>a.type==='split'?{...a,splits:a.splits.map(s=>({...s,categoryId:reference('categoryId',s.categoryId),merchantId:reference('merchantId',s.merchantId),tagIds:s.tagIds.map(id=>reference('tagIds',id)!)}))}:a.type==='tagIds'?{...a,value:a.value.map(id=>reference('tagIds',id)!)}:a.type==='categoryId'||a.type==='merchantId'?{...a,value:reference(a.type,a.value)}:a)})),ruleRuns:data.ruleRuns.map(r=>({...r,id:crypto.randomUUID()})),
    goals:data.goals.map(g=>({...g,id:goals.get(g.id)!})),goalAccounts:data.goalAccounts.map(l=>({...l,id:crypto.randomUUID(),goalId:goals.get(l.goalId)!,accountId:accounts.get(l.accountId)!})),goalConsumptions:data.goalConsumptions.map(c=>({...c,id:crypto.randomUUID(),goalId:goals.get(c.goalId)!,accountId:accounts.get(c.accountId)!,transactionId:c.transactionId?transactions.get(c.transactionId)!:null})),
    budgetBooks:data.budgetBooks.map(b=>({...b,id:budgetBooks.get(b.id)!,accountIds:b.accountIds.map(id=>accounts.get(id)!)})),budgetPeriods:data.budgetPeriods.map(p=>({...p,id:budgetPeriods.get(p.id)!,bookId:budgetBooks.get(p.bookId)!})),budgetEnvelopes:data.budgetEnvelopes.map(e=>({...e,id:crypto.randomUUID(),periodId:budgetPeriods.get(e.periodId)!,categoryId:categories.get(e.categoryId)!})),
    securities:data.securities.map(s=>({...s,id:securities.get(s.id)!})),securityPrices:data.securityPrices.map(p=>({...p,id:crypto.randomUUID(),securityId:securities.get(p.securityId)!})),trades:data.trades.map(t=>({...t,conversion:t.conversion?{...t.conversion,requestFingerprint:null}:null,id:crypto.randomUUID(),accountId:accounts.get(t.accountId)!,securityId:securities.get(t.securityId)!})),holdingSnapshots:data.holdingSnapshots.map(h=>({...h,id:crypto.randomUUID(),accountId:accounts.get(h.accountId)!,securityId:securities.get(h.securityId)!})),securitySplits:data.securitySplits.map(s=>({...s,id:crypto.randomUUID(),securityId:securities.get(s.securityId)!})),investmentCashBalances:data.investmentCashBalances.map(b=>({...b,id:cashBalances.get(b.id)!,accountId:accounts.get(b.accountId)!})),
    accounts: data.accounts.map(a => ({ ...a, id: accounts.get(a.id)! })),
    categories: data.categories.map(c => ({ ...c, id: categories.get(c.id)!, parentId: c.parentId ? categories.get(c.parentId)! : null })),
    transactions: data.transactions.map(t => ({ ...t, ...metadata(t),reconciledStatementId:t.reconciledStatementId?statements.get(t.reconciledStatementId)!:null, id: transactions.get(t.id)!, accountId: accounts.get(t.accountId)!, categoryId: t.categoryId ? categories.get(t.categoryId)! : null, transferId: t.transferId ? transfers.get(t.transferId)! : null })),
    valuations: data.valuations.map(v => ({ ...v, id: valuations.get(v.id)!, accountId: accounts.get(v.accountId)! })),
    budgets: data.budgets.map(b => ({ ...b, id: crypto.randomUUID(), categoryId: categories.get(b.categoryId)! })),
    tags: data.tags.map(t => ({ ...t, id: tags.get(t.id)! })), merchants: data.merchants.map(m => ({ ...m, id: merchants.get(m.id)! })),
    splitLines: data.splitLines.map(l => ({ ...l, ...metadata(l), id: splits.get(l.id)!, transactionId: transactions.get(l.transactionId)!, categoryId: l.categoryId ? categories.get(l.categoryId)! : null })),
    recurringEntries: data.recurringEntries.map(r => ({ ...r, ...metadata(r), id: recurring.get(r.id)!, accountId: r.accountId ? accounts.get(r.accountId)! : null, destinationAccountId: r.destinationAccountId ? accounts.get(r.destinationAccountId)! : null, categoryId: r.categoryId ? categories.get(r.categoryId)! : null })),
    recurringOccurrences: data.recurringOccurrences.map(o => ({ ...o, id: occurrences.get(o.id)!, recurringEntryId: recurring.get(o.recurringEntryId)! })),
    recurringAllocations: data.recurringAllocations.map(a => ({ ...a,requestFingerprint:null,conversion:a.conversion?{...a.conversion,accountId:accounts.get(a.conversion.accountId)!}:null, id: crypto.randomUUID(), occurrenceId: occurrences.get(a.occurrenceId)!, transactionId: a.transactionId ? transactions.get(a.transactionId)! : null, splitLineId: a.splitLineId ? splits.get(a.splitLineId)! : null })),
  };
}
