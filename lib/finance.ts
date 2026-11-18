import {taxAdvantaged} from './account-details.ts';
import type {InvestmentActivity} from './investment-reporting-schema.ts';
import type {TransferMatchRejection} from './transfer-rejection-types.ts';
import {replayLoanPrincipal} from './loan-principal.ts';
import type {RecurringMatcherSettings,RecurringMatchRejection} from "./recurring-matcher-types.ts";
import type {RecurringPriceChange} from "./recurring-price-types.ts";
import type {LoanTerms} from "./loan-types.ts";
import type {TransactionReceipt} from './statement-file-types.ts';
import type {PaymentConversion} from './recurring-fx.ts';
import type {ExchangeRate,TransferDetail,TransferFee} from './fx-types.ts';
import type {ContributionBalance} from './contribution-types.ts';
import type {GoalPledge} from './pledge-types.ts';
import type {StatementFile} from './statement-file-types.ts';
import type {AccountStatement,ReconciledStatus} from './reconciliation-types.ts';
import type {TransactionRule,RuleRun,RuleLock} from './rule-types.ts';
import type {SavingsGoal,GoalAccount,GoalConsumption} from './goal-types.ts';
import type {BudgetBook,BudgetPeriod,BudgetEnvelope} from "./budget-types.ts";
import type {Security,SecurityPrice,Trade,HoldingSnapshot,SecuritySplit,InvestmentCashBalance} from "./investment-types.ts";
import {investmentAccountBalance} from "./portfolio.ts";
// Money is stored in integer minor units. Transfers use two balanced ledger legs.
export const CURRENCIES = ["AED","AFN","ALL","AMD","ANG","AOA","ARS","AUD","AWG","AZN","BAM","BBD","BDT","BGN","BHD","BIF","BMD","BND","BOB","BRL","BSD","BTN","BWP","BYN","BZD","CAD","CDF","CHF","CLP","CNY","COP","CRC","CUC","CUP","CVE","CZK","DJF","DKK","DOP","DZD","EGP","ERN","ETB","EUR","FJD","FKP","GBP","GEL","GHS","GIP","GMD","GNF","GTQ","GYD","HKD","HNL","HRK","HTG","HUF","IDR","ILS","INR","IQD","IRR","ISK","JMD","JOD","JPY","KES","KGS","KHR","KMF","KPW","KRW","KWD","KYD","KZT","LAK","LBP","LKR","LRD","LSL","LYD","MAD","MDL","MGA","MKD","MMK","MNT","MOP","MRU","MUR","MVR","MWK","MXN","MYR","MZN","NAD","NGN","NIO","NOK","NPR","NZD","OMR","PAB","PEN","PGK","PHP","PKR","PLN","PYG","QAR","RON","RSD","RUB","RWF","SAR","SBD","SCR","SDG","SEK","SGD","SHP","SLE","SLL","SOS","SRD","SSP","STN","SVC","SYP","SZL","THB","TJS","TMT","TND","TOP","TRY","TTD","TWD","TZS","UAH","UGX","USD","UYU","UZS","VES","VND","VUV","WST","XAF","XCD","XCG","XDR","XOF","XPF","XSU","YER","ZAR","ZMW","ZWG","ZWL"] as const;
export type Currency = typeof CURRENCIES[number];
export const ACCOUNT_TYPES = ["checking", "savings", "credit", "investment", "crypto", "property", "vehicle", "loan", "other_liability", "other"] as const;
export type AccountType = typeof ACCOUNT_TYPES[number];
export const KINDS = ["standard", "funds_movement", "cc_payment", "loan_payment", "one_time", "investment_contribution"] as const;
export type Kind = typeof KINDS[number];
export const BUDGET_EXCLUDED_KINDS: readonly Kind[] = ["funds_movement", "cc_payment", "one_time"];
export const DEFAULT_CATEGORIES = [
  ["Income", "#4da568"], ["Housing", "#6471eb"], ["Groceries", "#e99537"],
  ["Dining", "#db5a54"], ["Transport", "#61a9c4"], ["Shopping", "#df4e92"],
  ["Health", "#805dee"], ["Entertainment", "#c44fe9"], ["Utilities", "#458b85"],
  ["Travel", "#d29448"], ["Other", "#737373"],
] as const;
export interface Profile {autoTransferDisabled?:number|null;marketFx?:number; ownerId: string; currency: Currency; name: string; revision: number; }
export const FINANCIAL_BACKUP_VERSION=36;
export interface Account { assetDetails?:import('./manual-asset-schema.ts').ManualAssetDetails|null; creditCardTerms?:import('./credit-card-types.ts').CreditCardTerms|null; subtype?:string|null;cryptoTaxTreatment?:import('./account-details.ts').CryptoTaxTreatment|null; archivedOn?:string|null; loanReplay?:number|null; cashPlanningExcluded?:number|null; loanTerms?:LoanTerms|null; id: string; ownerId: string; name: string; type: AccountType; currency: Currency; openingBalance: number; openingDate: string; archived: number; excludedFromReports?: number; }
export interface Category { id: string; ownerId: string; name: string; color: string; parentId?: string | null; lucideIcon?:string; }
export interface Transaction { investmentActivity?:InvestmentActivity|null; reconciledStatus?:ReconciledStatus;reconciledAt?:string|null;reconciledStatementId?:string|null; lockedFields?:RuleLock[]; id: string; ownerId: string; accountId: string; categoryId: string | null; date: string; name: string; amount: number; kind: Kind; transferId: string | null; notes: string; importKey: string | null; excluded?: number; merchantId?: string | null; tagIds?: string[]; splitParentId?: string; }
export interface Tag { id: string; ownerId: string; name: string; color: string; }
export interface Merchant { id: string; ownerId: string; name: string; color: string; websiteUrl: string | null; }
export interface SplitLine { reconciliation?: {status: ReconciledStatus; at: string | null}; lockedFields?:RuleLock[]; id: string; ownerId: string; transactionId: string; position: number; name: string; amount: number; categoryId: string | null; merchantId: string | null; tagIds: string[]; notes: string; kind: Kind; excluded: number; }
export interface Valuation { id: string; ownerId: string; accountId: string; date: string; amount: number; name: string; kind: "reconciliation" | "opening_anchor" | "current_anchor" | "history"; }
export interface Budget { id: string; ownerId: string; categoryId: string; month: string; currency: Currency; amount: number; }
export interface RecurrenceRule { frequency: "weekly" | "monthly" | "yearly"; interval: number; dayOfMonth: number | null; weekday: number | null; weekdayOrdinal: number | null; monthOfYear: number | null; }
export interface RecurringEntry { lastOccurrenceOn?:string|null;occurrenceCount?:number|null;updatedAt?:string|null; manual?:number|null; renewsOn?:string|null;trialEndsOn?:string|null;cancelledOn?:string|null; matching?:RecurringMatcherSettings|null; id: string; ownerId: string; name: string; accountId: string | null; destinationAccountId: string | null; categoryId: string | null; merchantId: string | null; tagIds: string[]; amount: number; currency: Currency; billType: "bill" | "subscription" | "installment" | "income" | "transfer" | "other"; status: "active" | "paused" | "ended" | "suggested" | "inactive"; anchorDate: string; startsOn: string; expectedDayOfMonth: number; rules: RecurrenceRule[]; endMode: "never" | "on_date" | "after_count"; endOn: string | null; endAfterCount: number | null; weekendAdjust: "none" | "skip" | "before" | "after"; amountStrategy: "fixed" | "average" | "last"; expectedAmountMin: number | null; expectedAmountMax: number | null; expectedAmountAvg: number | null; notifyDaysBefore: number; overdueGraceDays: number; notes: string; paymentUrl: string | null; autopay: number; }
export interface RecurringOccurrence { id: string; ownerId: string; recurringEntryId: string; originalDueOn: string; dueOn: string; currency: Currency; expectedAmount: number | null; status: "scheduled" | "paid" | "skipped" | "missed"; snoozedUntil: string | null; closedAt: string | null; closedSource: string | null; notes: string; }
export interface RecurringAllocation { matchConfidence?:number|null;matchSignals?:Record<string,unknown>|null; conversion?:PaymentConversion|null;requestFingerprint?:string|null; id: string; ownerId: string; occurrenceId: string; transactionId: string | null; splitLineId: string | null; amount: number; currency: Currency; sourceAmount: number | null; sourceCurrency: Currency | null; state: "suggested" | "confirmed"; source: "auto_matched" | "user_confirmed" | "user_created"; paidOn: string | null; }
export interface FinanceState { transferMatchRejections:TransferMatchRejection[]; recurringMatchRejections:RecurringMatchRejection[]; recurringPriceChanges:RecurringPriceChange[]; exchangeRates:ExchangeRate[];transferDetails:TransferDetail[];transferFees:TransferFee[]; contributionBalances:ContributionBalance[]; goalPledges:GoalPledge[]; transactionReceipts:TransactionReceipt[]; statementFiles:StatementFile[]; accountStatements:AccountStatement[]; rules:TransactionRule[];ruleRuns:RuleRun[]; goals:SavingsGoal[];goalAccounts:GoalAccount[];goalConsumptions:GoalConsumption[]; budgetBooks:BudgetBook[];budgetPeriods:BudgetPeriod[];budgetEnvelopes:BudgetEnvelope[]; securities:Security[]; securityPrices:SecurityPrice[]; trades:Trade[]; holdingSnapshots:HoldingSnapshot[]; securitySplits:SecuritySplit[]; investmentCashBalances:InvestmentCashBalance[]; profile: Profile | null; accounts: Account[]; categories: Category[]; transactions: Transaction[]; budgets: Budget[]; valuations: Valuation[]; tags: Tag[]; merchants: Merchant[]; splitLines: SplitLine[]; recurringEntries: RecurringEntry[]; recurringOccurrences: RecurringOccurrence[]; recurringAllocations: RecurringAllocation[]; }
export const emptyState: FinanceState = { transferMatchRejections:[], recurringMatchRejections:[], recurringPriceChanges:[], exchangeRates:[],transferDetails:[],transferFees:[], contributionBalances:[], goalPledges:[], transactionReceipts:[],statementFiles:[], accountStatements:[], rules:[],ruleRuns:[], goals:[],goalAccounts:[],goalConsumptions:[], budgetBooks:[],budgetPeriods:[],budgetEnvelopes:[], securities:[],securityPrices:[],trades:[],holdingSnapshots:[],securitySplits:[],investmentCashBalances:[], profile: null, accounts: [], categories: [], transactions: [], budgets: [], valuations: [], tags: [], merchants: [], splitLines: [], recurringEntries: [], recurringOccurrences: [], recurringAllocations: [] };
const currencyPrecisions = new Map<Currency, number>();
export function precision(currency: Currency) { const found=currencyPrecisions.get(currency);if(found!==undefined)return found;const places=new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;currencyPrecisions.set(currency,places);return places; }
export function parseMoney(input: string, currency: Currency): number {
  const text = input.trim();
  const places = precision(currency);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || (match[3]?.length ?? 0) > places) throw new Error(`Enter an amount with at most ${places} decimal places for ${currency}.`);
  const result = Number(match[2]) * 10 ** places + Number((match[3] ?? "").padEnd(places, "0"));
  if (!Number.isSafeInteger(result) || result > 1_000_000_000_000) throw new Error("Amount is too large.");
  return match[1] ? -result : result;
}
export function money(value: number, currency: Currency, compact = false) {
  if(compact)return new Intl.NumberFormat("en-US",{style:"currency",currency,notation:"compact",maximumFractionDigits:1}).format(value/10**precision(currency));
  const exact=moneyInput(Math.abs(value),currency),[whole,fraction]=exact.split("."),integer=new Intl.NumberFormat("en-US",{maximumFractionDigits:0}).format(BigInt(whole));
  return new Intl.NumberFormat("en-US",{style:"currency",currency}).formatToParts(value<0?-0:0).map(part=>part.type==="integer"?integer:part.type==="fraction"?fraction??"":part.value).join("");
}
export function moneyInput(value: number, currency: Currency) { const places=precision(currency),negative=value<0,absolute=(negative?-BigInt(value):BigInt(value)).toString().padStart(places+1,"0");return (negative?"-":"")+(places?absolute.slice(0,-places)+"."+absolute.slice(-places):absolute); }
export function sumMinorUnits(values: number[]) {
  const total = values.reduce((sum, value) => sum + BigInt(value), BigInt(0));
  const number = Number(total);
  if (!Number.isSafeInteger(number)) throw new Error("The combined amount exceeds the supported integer range.");
  return number;
}
export function today() { return new Date().toISOString().slice(0, 10); }
export function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= "1900-01-01" && value <= "2199-12-31" && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function isValuationOnlyType(type:AccountType){return ['property','vehicle','other','other_liability'].includes(type);}
export function liability(type: AccountType) { return type === "credit" || type === "loan" || type === "other_liability"; }
export function transferKind(from: AccountType, to: AccountType): Kind {
  if (to === "loan") return "loan_payment";
  if (liability(to)) return "cc_payment";
  if (["investment", "crypto"].includes(to) && !["investment", "crypto"].includes(from)) return "investment_contribution";
  return "funds_movement";
}
export function balance(account: Account, transactions: Transaction[], asOf = today(), valuations: Valuation[] = []) {
  if (account.openingDate > asOf) return 0;
  if(account.type==='loan'&&account.loanReplay===1){const replay=replayLoanPrincipal(account,{transactions,valuations},asOf);if(replay)return replay.balance;}
  const latest = valuations.filter(v => v.accountId === account.id && v.date >= account.openingDate && v.date <= asOf).sort((a, b) => b.date.localeCompare(a.date))[0];
  const base = latest?.amount ?? account.openingBalance;
  if (isValuationOnlyType(account.type)) return base;
  return sumMinorUnits([base, ...transactions.filter(t => t.accountId === account.id && t.date <= asOf && (latest ? t.date > latest.date : t.date >= account.openingDate)).map(t => t.amount)]);
}
export function accountBalance(account: Account, state: FinanceState, asOf = today()) { return ["investment","crypto"].includes(account.type) ? investmentAccountBalance(account,state,asOf).total : balance(account, state.transactions, asOf, state.valuations); }
export function reportingTransactions(state: FinanceState): Transaction[] {
  const children = new Map<string, SplitLine[]>();
  for (const line of state.splitLines) { const group = children.get(line.transactionId) ?? []; group.push(line); children.set(line.transactionId, group); }
  return state.transactions.flatMap(root => {
    const lines = children.get(root.id);
    return lines?.length ? lines.sort((a, b) => a.position - b.position).map(line => ({ ...root, ...(line.reconciliation ? {reconciledStatus:line.reconciliation.status,reconciledAt:line.reconciliation.at,reconciledStatementId:null} : {}), id: line.id, splitParentId: root.id, name: line.name, amount: line.amount, categoryId: line.categoryId, merchantId: line.merchantId, notes: line.notes, kind: line.kind, lockedFields:line.lockedFields??[], excluded: root.excluded || line.excluded, tagIds: line.tagIds })) : [root];
  });
}
export function monthlySummary(state: FinanceState, currency: Currency, month: string, asOf = today()) {
  const accounts = state.accounts.filter(a => a.currency === currency && !a.excludedFromReports);
  const ids = new Set(accounts.filter(a=>!taxAdvantaged(a)).map(a => a.id));
  const transactions = reportingTransactions(state).filter(t => ids.has(t.accountId) && t.date.startsWith(month) && t.date <= asOf && !t.excluded && !BUDGET_EXCLUDED_KINDS.includes(t.kind));
  const income = sumMinorUnits(transactions.filter(t => t.amount > 0).map(t => t.amount)), expenses = sumMinorUnits(transactions.filter(t => t.amount < 0).map(t => -t.amount));
  const assets = sumMinorUnits(accounts.filter(a => !liability(a.type)).map(a => accountBalance(a, state, asOf)));
  const debtBalances = sumMinorUnits(accounts.filter(a => liability(a.type)).map(a => accountBalance(a, state, asOf)));
  return { income, expenses, cashflow: income - expenses, assets, liabilities: -debtBalances, netWorth: assets + debtBalances, transactions };
}
export function categorySpending(transactions: Transaction[], categoryId: string) {
  return Math.max(0, -sumMinorUnits(transactions.filter(t => t.categoryId === categoryId).map(t => t.amount)));
}
export function netWorthSeries(state: FinanceState, currency: Currency, month: string) {
  const [year, m] = month.split("-").map(Number);
  return Array.from({ length: 6 }, (_, index) => {
    const d = new Date(Date.UTC(year, m - 5 + index, 0));
    const date = d.toISOString().slice(0, 10);
    const end = date > today() ? today() : date;
    return { label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }), value: sumMinorUnits(state.accounts.filter(a => a.currency === currency && !a.excludedFromReports).map(a => accountBalance(a, state, end))) };
  });
}
