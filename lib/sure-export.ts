import {importAssetDetails} from './manual-asset-schema.ts';
import {importCardTerms} from './credit-card-schema.ts';
import {validSubtype,subtypeCatalog,validateAccountDetails,type CryptoTaxTreatment} from './account-details.ts';
import {sourceArchiveDate} from './account-archive.ts';
import {investmentActivitySchema,tradeExcludedSchema} from './investment-reporting-schema.ts';
import {sourceRecurringTimestamp,recurringObservationFields} from './recurring-observations.ts';
import {recurringMatcherSettingsSchema,matcherJSON} from "./recurring-matcher-schema.ts";
import {importLoanTerms} from "./loan-import.ts";
import {convertForeignTrade,convertForeignHolding} from './investment-fx.ts';
import {investmentFxReview,type InvestmentFxReviewRow} from './sure-import-fx.ts';
import type {ExchangeRate} from './fx-types.ts';
import {impliedRate} from './fx.ts';
import {importSureRules} from './rule-import.ts';
import {canonicalDecimal,QTY_SCALE,PRICE_SCALE,decimalAtoms,quantityValue} from "./decimal.ts";
import {accountPositions} from "./portfolio.ts";
import { isValuationOnlyType, ACCOUNT_TYPES, CURRENCIES, KINDS, liability, parseMoney, sumMinorUnits, today, transferKind, validDate, type RecurrenceRule, type AccountType, type Currency } from "./finance.ts";
import { validateWorkspace, workspaceState, MAX_IMPORT_BYTES, type MigrationResult, type WorkspaceData } from "./workspace.ts";

type RecordData = Record<string, unknown>;
interface SourceRecord { type: string; data: RecordData; line: number; version?:unknown; }
const typeMap: Record<string, AccountType> = { Depository: "checking", Investment: "investment", Crypto: "crypto", Property: "property", Vehicle: "vehicle", OtherAsset: "other", CreditCard: "credit", Loan: "loan", OtherLiability: "other_liability" };
function required(data: RecordData, key: string, context: string): string {
  const value = data[key]; if (typeof value !== "string" || !value.trim()) throw new Error(`${context}: ${key} is required.`); return value.trim();
}
function optional(value: unknown): string | null { if (value === null || value === undefined || value === "") return null; if (typeof value !== "string") throw new Error("Expected a text identifier."); return value; }
function flag(value: unknown) { if ([true, 1, "1", "true"].includes(value as string)) return 1; if ([false, 0, "0", "false", null, undefined, ""].includes(value as string)) return 0; throw new Error("Invalid boolean flag in export."); }
function sourceCurrency(value: unknown): Currency {
  if (typeof value !== "string" || !CURRENCIES.includes(value as Currency)) throw new Error(`Unsupported currency: ${String(value)}.`); return value as Currency;
}
export function sourceAmount(value: unknown, currency: Currency) {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("Expected a decimal money amount.");
  let decimal = String(value).trim();
  // Rails BigDecimal JSON can include redundant fractional zeroes, including JPY.
  if (/^-?\d+\.\d+$/.test(decimal)) decimal = decimal.replace(/0+$/, "").replace(/\.$/, "");
  return parseMoney(decimal, currency);
}
function sourceDate(value: unknown, context: string) { if (typeof value !== "string" || !validDate(value)) throw new Error(`${context}: invalid date.`); return value; }
// Sure records expenses as positive; canonicalize zero after reversing that sign.
function ledgerSourceAmount(value: unknown, currency: Currency) { return -sourceAmount(value,currency) || 0; }
function parseRecords(content: string) {
  if (new TextEncoder().encode(content).length > MAX_IMPORT_BYTES) throw new Error("Choose an export smaller than 8 MB.");
  const records = new Map<string, SourceRecord[]>(), counts: Record<string, number> = Object.create(null);
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines.length > 100_000) throw new Error("The export exceeds 100,000 source lines.");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim(); if (!line) continue;
    if (line.length > 250_000) throw new Error(`Line ${index + 1} is too large.`);
    let raw: unknown; try { raw = JSON.parse(line); } catch { throw new Error(`Line ${index + 1} is not valid JSON.`); }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Line ${index + 1} must contain a record.`);
    const record = raw as RecordData;
    if (typeof record.type !== "string" || !/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(record.type) || !record.data || typeof record.data !== "object" || Array.isArray(record.data)) throw new Error(`Line ${index + 1} must contain type and data fields.`);
    const item = { type: record.type, data: record.data as RecordData, line: index + 1,version:record.version };
    const group = records.get(item.type) ?? []; group.push(item); records.set(item.type, group); counts[item.type] = (counts[item.type] ?? 0) + 1;
    if (records.size > 64) throw new Error("This file has too many unknown record types.");
  }
  if (!counts.Account) throw new Error("No accounts found. Choose all.ndjson from a Sure version 2 data export.");
  // Source IDs are scoped by record type. Never let duplicates overwrite a map entry.
  for (const [type, group] of records) {
    const ids = new Set<string>();
    for (const { data, line } of group) {
      const id = required(data, "id", `Line ${line}`);
      if (ids.has(id)) throw new Error(`Duplicate ${type} id on line ${line}.`); ids.add(id);
    }
  }
  return { records, counts };
}
export function parseSureExport(content: string, options: { exportDate: string; name: string; currency: Currency; ruleCurrency?:Currency;marketFx?:0|1; investmentRates?:ExchangeRate[];investmentReviewOffset?:number }): MigrationResult & {entryValuationIds:string[]} {
  const exportDate = sourceDate(options.exportDate, "Export snapshot date");
  if (exportDate > today()) throw new Error("The export snapshot date cannot be in the future.");
  const { records, counts } = parseRecords(content), warnings: string[] = [];
  const get = (type: string) => records.get(type) ?? [];
  const data: WorkspaceData = { transferMatchRejections:[],recurringMatchRejections:[], recurringPriceChanges:[], exchangeRates:[],transferDetails:[],transferFees:[],contributionBalances:[],goalPledges:[],transactionReceipts:[],statementFiles:[], accountStatements:[], rules:[],ruleRuns:[], goals:[],goalAccounts:[],goalConsumptions:[], profile: {marketFx:options.marketFx??0,name: options.name, currency: options.currency }, budgetBooks:[],budgetPeriods:[],budgetEnvelopes:[],securities:[],securityPrices:[],trades:[],holdingSnapshots:[],securitySplits:[],investmentCashBalances:[], accounts: [], categories: [], transactions: [], valuations: [], budgets: [], tags: [], merchants: [], splitLines: [], recurringEntries: [], recurringOccurrences: [], recurringAllocations: [] };
  let observedDifferences=0;const fxRows:InvestmentFxReviewRow[]=[];if(options.investmentRates)data.exchangeRates=options.investmentRates.map(({ownerId,...rate})=>({...rate}));
  const fxContext={exchangeRates:options.investmentRates??[]};
  const sourceAccounts = new Map<string, RecordData>();
  for (const { data: source, line } of get("Account")) {
    const id = required(source, "id", `Line ${line}`), accountableType = required(source, "accountable_type", `Line ${line}`);
    let type = typeMap[accountableType];
    if (!type || !ACCOUNT_TYPES.includes(type)) throw new Error(`Line ${line}: account type ${accountableType} is not supported.`);
    const accountable = source.accountable && typeof source.accountable === "object" ? source.accountable as RecordData : {};
    if (type === "checking" && (source.subtype === "savings" || accountable.subtype === "savings")) type = "savings";
    const rawSubtype=source.subtype??accountable.subtype,subtype=rawSubtype==null||rawSubtype===''?undefined:rawSubtype;
    if(subtype!==undefined&&!validSubtype(subtype))throw new Error(`Line ${line}: account subtype must be trimmed text of at most 80 characters without controls.`);
    if(subtype&&!Object.hasOwn(subtypeCatalog(type),subtype))warnings.push(`Account “${String(source.name)}”: subtype “${subtype}” is not in the pinned Sure catalog. It is retained; investment tax treatment follows Sure’s taxable fallback, with no name-based inference.`);
    const cryptoTaxTreatment=accountableType==='Crypto'?(accountable.tax_treatment??source.tax_treatment??undefined) as CryptoTaxTreatment|undefined:undefined;
    validateAccountDetails(type,subtype,cryptoTaxTreatment);
    const classification = source.classification;
    if (classification && classification !== (liability(type) ? "liability" : "asset")) throw new Error(`Line ${line}: account classification does not match its type.`);
    const currency = sourceCurrency(source.currency), name = required(source, "name", `Line ${line}`);
    // Validate the source balance before importing any dependent history.
    sourceAmount(source.balance, currency);
    const archive=sourceArchiveDate(source);if(archive.warning)warnings.push(`Account “${name}”: ${archive.warning}`);
    const assetDetails=importAssetDetails(accountable,type);const creditCardTerms=type==='credit'?importCardTerms(accountable,currency):null;
    data.accounts.push({...(assetDetails?{assetDetails}:{}),...(creditCardTerms?{creditCardTerms}:{}),...(subtype?{subtype}:{}),...(cryptoTaxTreatment?{cryptoTaxTreatment}:{}),...(archive.archivedOn?{archivedOn:archive.archivedOn}:{}),...(accountableType==="Depository"?{cashPlanningExcluded:[source.subtype,accountable.subtype].includes("hsa")?1:0}:{}), id, name, type, currency, openingBalance: 0, openingDate: exportDate, archived: source.status === "disabled" ? 1 : 0, excludedFromReports: flag(source.exclude_from_reports) });
    sourceAccounts.set(id, source);
  }
  const accounts = new Map(data.accounts.map(a => [a.id, a]));
  const accountFor = (source: RecordData, line: number) => {
    const id = required(source, "account_id", `Line ${line}`), account = accounts.get(id);
    if (!account) throw new Error(`Line ${line}: record references a missing account.`);
    return account;
  };
  for (const { data: source, line } of get("Category")) data.categories.push({ ...(source.lucide_icon?{lucideIcon:String(source.lucide_icon)}:{}), id: required(source, "id", `Line ${line}`), name: required(source, "name", `Line ${line}`), color: required(source, "color", `Line ${line}`), parentId: optional(source.parent_id) });
  let invalidLinks = 0;
  const link = (value: unknown) => {
    if (value === null || value === undefined || value === "") return null;
    try { const text = String(value).trim(); const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`); if (!["http:","https:"].includes(url.protocol) || url.username || url.password) throw new Error(); return url.href; } catch { invalidLinks++; return null; }
  };
  const tagsFor = (value: unknown): string[] => { if (value === null || value === undefined) return []; if (!Array.isArray(value) || value.some(id => typeof id !== "string")) throw new Error("Invalid tag list in source export."); return value as string[]; };
  for (const { data: source, line } of get("Tag")) data.tags.push({ id: required(source,"id",`Line ${line}`), name: required(source,"name",`Line ${line}`), color: typeof source.color === "string" ? source.color : "#737373" });
  for (const { data: source, line } of [...get("Merchant"), ...get("ProviderMerchant")]) data.merchants.push({ id: required(source,"id",`Line ${line}`), name: required(source,"name",`Line ${line}`), color: typeof source.color === "string" ? source.color : "#737373", websiteUrl: link(source.website_url) });
  const appendTransaction = (source: RecordData, line: number) => {
    const account = accountFor(source, line), currency = sourceCurrency(source.currency ?? account.currency);
    if (currency !== account.currency) throw new Error(`Line ${line}: a transaction uses a different currency from its account. Cross-currency entries require the FX workflow.`);
    const kind = source.kind ?? "standard";
    if (typeof kind !== "string" || !KINDS.includes(kind as typeof KINDS[number])) throw new Error(`Line ${line}: unsupported transaction kind.`);
    data.transactions.push({ ...(source.investment_activity_label==null?{}:{investmentActivity:investmentActivitySchema.parse(source.investment_activity_label)}),reconciledStatus:'unreconciled',reconciledAt:null,reconciledStatementId:null, lockedFields:[], id: required(source, "id", `Line ${line}`), accountId: account.id, date: sourceDate(source.date, `Line ${line}`), name: typeof source.name === "string" && source.name.trim() ? source.name : "Imported transaction", amount: ledgerSourceAmount(source.amount, currency), categoryId: optional(source.category_id), notes: typeof source.notes === "string" ? source.notes : "", kind: kind as typeof KINDS[number], transferId: null, importKey: null, excluded: flag(source.excluded), merchantId: optional(source.merchant_id), tagIds: tagsFor(source.tag_ids) });
  };
  for (const { data: source, line } of get("Transaction")) {
    if (Array.isArray(source.split_lines) && source.split_lines.length) {
      appendTransaction({ ...source, excluded: false }, line);
      const parent = data.transactions.at(-1)!;
      for (const [position, child] of source.split_lines.entries()) {
        if (!child || typeof child !== "object" || Array.isArray(child)) throw new Error(`Line ${line}: malformed split line.`);
        const row = child as RecordData, account = accountFor(source,line), currency = sourceCurrency(row.currency ?? account.currency);
        if (currency !== account.currency) throw new Error(`Line ${line}: a split line uses another currency.`);
        const kind = String(row.kind ?? source.kind ?? "standard");
        if (!["standard","one_time","loan_payment","investment_contribution"].includes(kind)) throw new Error(`Line ${line}: unsupported split line kind.`);
        data.splitLines.push({ lockedFields:[], id: required(row,"id",`Line ${line}`), transactionId: parent.id, position, name: typeof row.name === "string" && row.name.trim() ? row.name : parent.name, amount: ledgerSourceAmount(row.amount,currency), categoryId: optional(row.category_id), merchantId: optional(row.merchant_id), tagIds: tagsFor(row.tag_ids), notes: typeof row.notes === "string" ? row.notes : "", kind: kind as "standard", excluded: flag(row.excluded) });
      }
    } else appendTransaction(source,line);
  }

  const transactions = new Map(data.transactions.map(t => [t.id, t]));
  for(const {data:source,line} of get('RejectedTransfer'))data.transferMatchRejections.push({id:required(source,'id',`Line ${line}`),outflowTransactionId:required(source,'outflow_transaction_id',`Line ${line}`),inflowTransactionId:required(source,'inflow_transaction_id',`Line ${line}`),createdAt:sourceRecurringTimestamp(source.created_at,`Line ${line}`)??null,updatedAt:sourceRecurringTimestamp(source.updated_at,`Line ${line}`)??null});
  for (const { data: source, line } of get("Transfer")) {
    if (source.status !== "confirmed" && source.status !== "pending") throw new Error(`Line ${line}: invalid transfer status.`);
    const outflow = transactions.get(required(source, "outflow_transaction_id", `Line ${line}`)), inflow = transactions.get(required(source, "inflow_transaction_id", `Line ${line}`));
    if (!outflow || !inflow) throw new Error(`Line ${line}: transfer references missing transactions.`);
    if (outflow.transferId || inflow.transferId) throw new Error(`Line ${line}: a transaction belongs to more than one transfer.`);
    if (outflow.amount >= 0 || inflow.amount <= 0) throw new Error(`Line ${line}: transfer inflow and outflow signs are invalid.`);
    const from = accounts.get(outflow.accountId)!, to = accounts.get(inflow.accountId)!;
    if(from.currency!==to.currency||source.status==='pending'){const ratio=impliedRate(-outflow.amount,from.currency,inflow.amount,to.currency);data.transferDetails.push({...(source.status==='pending'?{status:'pending' as const,createdAt:sourceRecurringTimestamp(source.created_at,`Line ${line}`)??null,updatedAt:sourceRecurringTimestamp(source.updated_at,`Line ${line}`)??null}:{}),id:required(source,'id',`Line ${line}`),date:outflow.date,destinationDate:inflow.date,fromCurrency:from.currency,toCurrency:to.currency,fromAmount:-outflow.amount,toAmount:inflow.amount,rateNumerator:String(ratio.numerator),rateDenominator:String(ratio.denominator),rateDate:null,rateSource:'imported',sourceFee:0,destinationFee:0,requestId:null,requestFingerprint:null});}
    outflow.transferId = inflow.transferId = required(source, "id", `Line ${line}`);
    if(source.status==='pending')continue;
    outflow.kind = transferKind(from.type, to.type); inflow.kind = "funds_movement";
    if (["investment", "crypto"].includes(to.type) && source.investment_contribution !== null && source.investment_contribution !== undefined) {outflow.kind = flag(source.investment_contribution) ? "investment_contribution" : "funds_movement";outflow.lockedFields=[...new Set([...(outflow.lockedFields??[]),"kind" as const])];}
  }
  if(data.transferDetails.length)warnings.push('Confirmed cross-currency transfers retain their actual posted amounts and implied rate snapshots. The export omits transfer-fee associations and the global exchange-rate library; separate fee transactions remain independent expenses.');
  const decimalSource=(value:unknown,places:number)=>canonicalDecimal(String(value),places);
  const securityFor=(source:RecordData,line:number)=>{
    const id=required(source,"security_id",`Line ${line}`),ticker=required(source,"ticker",`Line ${line}`).toUpperCase(),exchange=String(source.exchange_operating_mic??"").toUpperCase();
    const existing=data.securities.find(s=>s.id===id);
    if(existing){if(existing.ticker!==ticker||(existing.exchange&&exchange&&existing.exchange!==exchange))throw new Error(`Line ${line}: conflicting security identity.`);if(!existing.exchange)existing.exchange=exchange;if(source.kind==="cash")existing.kind="cash";if(source.website_url)existing.websiteUrl=link(source.website_url);return existing;}
    const security={id,ticker,exchange,name:typeof source.security_name==="string"&&source.security_name.trim()?source.security_name:ticker,kind:(source.kind??"standard") as "standard",websiteUrl:link(source.website_url)};data.securities.push(security);return security;
  };
  for(const {data:source,line} of get("Trade")){
    const account=accountFor(source,line),currency=sourceCurrency(source.currency??account.currency),security=securityFor(source,line),qty=decimalSource(source.qty,QTY_SCALE),price=decimalSource(source.price,PRICE_SCALE),cashAmount=-sourceAmount(source.amount,currency);
    const gross=quantityValue(qty,price,new Intl.NumberFormat("en",{style:"currency",currency}).resolvedOptions().maximumFractionDigits??2),fee=decimalAtoms(qty,QTY_SCALE)===BigInt(0)?0:Math.max(0,-cashAmount-gross);
    if(currency!==account.currency&&options.investmentRates===undefined)throw new Error(`Line ${line}: Sure v2 omits this foreign trade's applied ${currency} → ${account.currency} rate. Enable keeping and using your dated rate library, then preview again, or import the reviewed amounts through investment CSV/manual entry.`);
    const created=typeof source.created_at==="string"?Date.parse(source.created_at):NaN,fraction=typeof source.created_at==="string"?/\.(\d+)/.exec(source.created_at)?.[1]??"":"";
    const sequence=Number.isFinite(created)?created*1000+Number(fraction.padEnd(6,"0").slice(3,6)):line;
    const row={...(source.excluded==null?{}:{excluded:tradeExcludedSchema.parse(typeof source.excluded==='boolean'?+source.excluded:source.excluded)}),conversion:null,id:required(source,"id",`Line ${line}`),accountId:account.id,securityId:security.id,date:sourceDate(source.date,`Line ${line}`),name:typeof source.name==="string"&&source.name.trim()?source.name:`Imported ${security.ticker} activity`,qty,price,fee,cashAmount,currency,importKey:null,activity:decimalAtoms(qty,QTY_SCALE)===BigInt(0)?"cash":"unclassified",sequence,notes:typeof source.notes==="string"?source.notes:""} as WorkspaceData['trades'][number];
    if(currency!==account.currency){try{const converted={...row,...convertForeignTrade(fxContext,row,account.currency)};data.trades.push(converted);fxRows.push({type:'trade',line,sourceId:row.id,accountName:account.name,security:security.ticker,date:row.date,price:converted.price,amount:converted.cashAmount,fee:converted.fee,costBasis:null,conversion:converted.conversion});}catch(error){throw new Error(`Line ${line}: ${(error as Error).message}`);}}else data.trades.push(row);
  }
  for(const {data:source,line} of get("Holding")){
    const account=accountFor(source,line),currency=sourceCurrency(source.currency??account.currency),security=securityFor(source,line);
    if(currency!==account.currency&&options.investmentRates===undefined)throw new Error(`Line ${line}: this foreign holding needs a ${currency} → ${account.currency} rate. Enable keeping and using your dated rate library, then preview again, or import the reviewed observation through investment CSV/manual entry.`);
    const row={...(source.excluded==null?{}:{excluded:tradeExcludedSchema.parse(typeof source.excluded==='boolean'?+source.excluded:source.excluded)}),conversion:null,id:required(source,"id",`Line ${line}`),accountId:account.id,securityId:security.id,date:sourceDate(source.date,`Line ${line}`),qty:decimalSource(source.qty,QTY_SCALE),price:decimalSource(source.price,PRICE_SCALE),amount:sourceAmount(source.amount,currency),currency,costBasis:source.cost_basis===null||source.cost_basis===undefined?null:decimalSource(source.cost_basis,PRICE_SCALE),costBasisSource:optional(source.cost_basis_source) as "manual"|null,costBasisLocked:flag(source.cost_basis_locked),securityLocked:flag(source.security_locked)} as WorkspaceData['holdingSnapshots'][number];
    if(currency!==account.currency){try{const converted={...row,...convertForeignHolding(fxContext,row,account.currency,undefined,undefined,true)};data.holdingSnapshots.push(converted);const reportedValueDiffers=row.amount!==quantityValue(row.qty,row.price,new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2);fxRows.push({type:'holding',reportedValueDiffers,line,sourceId:row.id,accountName:account.name,security:security.ticker,date:row.date,price:converted.price,amount:converted.amount,fee:null,costBasis:converted.costBasis,conversion:converted.conversion});if(reportedValueDiffers&&++observedDifferences<=10)warnings.push(`Line ${line}: the holding's reported ${currency} total differs from quantity × rounded unit price. Its reported total is retained in the conversion.`);}catch(error){throw new Error(`Line ${line}: ${(error as Error).message}`);}}else data.holdingSnapshots.push(row);
  }
  if(data.trades.length)warnings.push("Sure's v2 export omits trade activity labels and explicit fees. Share quantities and cash amounts are retained. Imported share activities remain unclassified, and any fee is inferred from their cash amount; review them before using calculated gains. Existing holding cost-basis overrides are preserved.");
  if(data.securities.length)warnings.push("Securities and dated holdings are retained without connecting a broker or fetching live prices. Additional security classification/exchange metadata and stock-split history are not supplied by this migration; record dated prices and corporate actions manually.");
  const valuationMap = new Map<string, WorkspaceData["valuations"][number]>();
  let convertedBalances = 0;
  // Daily account-currency balances preserve historical market and reconciliation changes.
  for (const { data: source, line } of get("Balance")) {
    const account = accountFor(source, line), currency = sourceCurrency(source.currency);
    if (currency !== account.currency) { convertedBalances++; continue; }
    const date = sourceDate(source.date, `Line ${line}`), amount = sourceAmount(source.balance, currency) * (liability(account.type) ? -1 : 1);
    const key = JSON.stringify([account.id, date]);
    if (valuationMap.has(key)) throw new Error(`Line ${line}: duplicate daily balance for this account and date.`);
    valuationMap.set(key, { id: `balance:${required(source, "id", `Line ${line}`)}`, accountId: account.id, date, amount, name: "Imported daily balance", kind: "history" });
  }
  // Retain exported market history as dated contribution checkpoints. Every
  // row in an account must carry market flows; missing rows are not zeroes.
  let importedContributionAccounts=0,missingContributionAccounts=0;
  for(const account of data.accounts.filter(a=>['investment','crypto'].includes(a.type))){
    const rows=get('Balance').filter(r=>r.data.account_id===account.id&&r.data.currency===account.currency).sort((a,b)=>String(a.data.date).localeCompare(String(b.data.date)));
    if(!rows.length||rows.some(r=>r.data.net_market_flows===null||r.data.net_market_flows===undefined)){missingContributionAccounts++;continue;}
    let market=BigInt(0);for(const {data:source,line} of rows){market+=BigInt(sourceAmount(source.net_market_flows,account.currency));const contribution=BigInt(sourceAmount(source.balance,account.currency))-market;if(contribution>BigInt(Number.MAX_SAFE_INTEGER)||contribution< -BigInt(Number.MAX_SAFE_INTEGER))throw new Error(`Line ${line}: net contributions exceed the supported exact money range.`);data.contributionBalances.push({id:`contribution:${required(source,'id',`Line ${line}`)}`,accountId:account.id,date:sourceDate(source.date,`Line ${line}`),amount:Number(contribution),source:'sure_balance',notes:'Net contributions from exported balance less cumulative market changes.'});}importedContributionAccounts++;
  }
  if(importedContributionAccounts)warnings.push(`Exported cumulative market changes are retained as dated contribution checkpoints for ${importedContributionAccounts} investment/crypto account(s). These preserve net-contribution progress separately from current market value.`);
  if(missingContributionAccounts)warnings.push(`${missingContributionAccounts} investment/crypto account(s) have no complete exported market-flow history. Contribution progress uses recorded trades where sufficient; a dated net-contribution checkpoint is needed for unexplained holdings or security movements.`);
  const explicitValuationDates = new Set<string>(),entryValuationIds=new Set<string>();
  for (const { data: source, line } of get("Valuation")) {
    const account = accountFor(source, line), currency = sourceCurrency(source.currency ?? account.currency), date = sourceDate(source.date, `Line ${line}`);
    if (currency !== account.currency) throw new Error(`Line ${line}: a valuation uses a different currency from its account.`);
    const key = JSON.stringify([account.id, date]);
    if (explicitValuationDates.has(key)) throw new Error(`Line ${line}: duplicate valuation for the same account and date.`);
    explicitValuationDates.add(key);
    const kind = source.kind ?? "reconciliation";
    if (!["opening_anchor", "current_anchor", "reconciliation"].includes(String(kind))) throw new Error(`Line ${line}: unknown valuation kind.`);
    entryValuationIds.add(`valuation:${required(source, "id", `Line ${line}`)}`);
    valuationMap.set(JSON.stringify([account.id, date]), { id: `valuation:${required(source, "id", `Line ${line}`)}`, accountId: account.id, date, amount: sourceAmount(source.amount, currency) * (liability(account.type) ? -1 : 1), name: typeof source.name === "string" && source.name.trim() ? source.name : "Imported balance", kind: kind as "reconciliation" | "opening_anchor" | "current_anchor" });
  }
  for (const account of data.accounts) {
    const history = [...valuationMap.values()].filter(v => v.accountId === account.id), entries = [...data.transactions,...data.trades.map(t=>({accountId:t.accountId,date:t.date,amount:t.cashAmount}))].filter(t => t.accountId === account.id);
    const dates = [exportDate, ...history.map(v => v.date), ...entries.map(t => t.date),...data.holdingSnapshots.filter(h=>h.accountId===account.id).map(h=>h.date),...data.investmentCashBalances.filter(b=>b.accountId===account.id).map(b=>b.date)];
    account.openingDate = dates.sort()[0];
    const source = sourceAccounts.get(account.id)!;
    const sourceBalance = sourceAmount(source.balance, account.currency) * (liability(account.type) ? -1 : 1);
    // This snapshot is explicit in the preview; imported transactions are never replayed on top of the exported current balance.
    valuationMap.set(JSON.stringify([account.id, exportDate]), { id: `snapshot:${account.id}`, accountId: account.id, date: exportDate, amount: sourceBalance, name: "Sure export balance", kind: "current_anchor" });
    const first = history.sort((a, b) => a.date.localeCompare(b.date))[0];
    if (first && !isValuationOnlyType(account.type)) account.openingBalance = sumMinorUnits([first.amount, ...entries.filter(t => t.date <= first.date).map(t => -t.amount)]);
    else if (first) account.openingBalance = first.amount;
    else account.openingBalance = sumMinorUnits([sourceBalance, ...(isValuationOnlyType(account.type) ? [] : entries.filter(t => t.date <= exportDate).map(t => -t.amount))]);
    if(account.type==="loan") {
      const terms=source.accountable && typeof source.accountable==="object" && !Array.isArray(source.accountable)?source.accountable as RecordData:{};
      try {account.loanTerms=importLoanTerms(terms,account.currency,{principal:Math.max(0,-(first?.amount??sourceBalance)),date:first?.date??account.openingDate});}
      catch(error){throw new Error(`Loan ${account.name}: ${error instanceof Error?error.message:'Invalid terms.'}`);}
      if(!terms.initial_balance||Number(terms.initial_balance)<=0||!terms.start_date)warnings.push(`Loan ${account.name}: missing original principal or origination uses the first tracked balance/date. Review those contract fields before relying on the schedule.`);
    }
    if(["investment","crypto"].includes(account.type))account.openingBalance=sumMinorUnits([account.openingBalance,-sumMinorUnits(accountPositions(workspaceState(data),{...account,ownerId:"preview"},first?.date??exportDate).map(p=>p.value))]);
  }
  data.valuations = [...valuationMap.values()];
  const budgetBooksBySource=new Map<string,WorkspaceData['budgetBooks'][number]>(),sourceBudgetCurrency=new Map<string,Currency>();
  const sourceBudgets=get("Budget").map(item=>({...item,start:sourceDate(item.data.start_date,`Line ${item.line}`)})).sort((a,b)=>a.start.localeCompare(b.start));
  let personalIndex=0,unmappedPersonal=0;
  for(const {data:source,line,start} of sourceBudgets){
    const id=required(source,"id",`Line ${line}`),currency=sourceCurrency(source.currency),userId=optional(source.user_id),key=userId?`personal:${userId}`:'household';let book=budgetBooksBySource.get(key);
    if(!book){const accountIds=userId?[...sourceAccounts.entries()].filter(([,a])=>a.owner_id===userId).map(([id])=>id):[];if(userId&&!accountIds.length)unmappedPersonal++;
      book={id:`budget-book:${key}`,name:userId?`Imported personal budget ${++personalIndex}`:'Household budget',currency,startDay:Number(start.slice(8))<=28?Number(start.slice(8)):1,accountMode:userId?'selected':'all',accountIds,sourceKind:userId?'personal':'household',sourceReference:userId,legacyCompat:userId?0:1};budgetBooksBySource.set(key,book);data.budgetBooks.push(book);
    }
    book.currency=currency;book.startDay=Number(start.slice(8))<=28?Number(start.slice(8)):1;
    const maybeMoney=(value:unknown)=>value===null||value===undefined?null:sourceAmount(value,currency);
    data.budgetPeriods.push({id,bookId:book.id,startDate:start,endDate:sourceDate(source.end_date,`Line ${line}`),currency,budgetedSpending:maybeMoney(source.budgeted_spending),expectedIncome:maybeMoney(source.expected_income),autoTotal:0});sourceBudgetCurrency.set(id,currency);
  }
  for(const {data:source,line} of get("BudgetCategory")){
    const periodId=required(source,"budget_id",`Line ${line}`),currency=sourceBudgetCurrency.get(periodId);if(!currency)throw new Error(`Line ${line}: missing parent budget.`);if(sourceCurrency(source.currency??currency)!==currency)throw new Error(`Line ${line}: budget allocations in another currency require the FX workflow.`);
    data.budgetEnvelopes.push({id:required(source,"id",`Line ${line}`),periodId,categoryId:required(source,"category_id",`Line ${line}`),allocated:sourceAmount(source.budgeted_spending,currency),rolloverEnabled:flag(source.rollover_enabled) as 0|1,importedCarry:sourceAmount(source.rolled_over_amount??"0",currency)});
  }
  if(data.budgetPeriods.length)warnings.push("Budget periods, expected income, category allocations and rollover choices are retained. Carry recalculates from imported history; the first initialized period keeps its exported starting carry. Household/personal plans are local copies owned by you, not sharing grants. Other-currency actuals remain separate until FX conversion is implemented.");
  if(unmappedPersonal)warnings.push(`${unmappedPersonal} personal budget plan(s) have no matching account ownership in this export. They retain their allocations with an empty account scope; select the correct accounts in the plan settings.`);
  const sourceRules = new Map<string, RecurrenceRule[]>();
  for (const { data: source, line } of get("RecurrenceRule")) {
    const id = required(source,"recurring_transaction_id",`Line ${line}`), rules = sourceRules.get(id) ?? [];
    rules.push({ frequency: source.frequency as RecurrenceRule["frequency"], interval: Number(source.interval ?? 1), dayOfMonth: source.day_of_month === null || source.day_of_month === undefined ? null : Number(source.day_of_month), weekday: source.weekday === null || source.weekday === undefined ? null : Number(source.weekday), weekdayOrdinal: source.weekday_ordinal === null || source.weekday_ordinal === undefined ? null : Number(source.weekday_ordinal), monthOfYear: source.month_of_year === null || source.month_of_year === undefined ? null : Number(source.month_of_year) }); sourceRules.set(id,rules);
  }
  let missingDestinations = 0, holidayCalendars = 0;
  for (const { data: source, line } of get("RecurringTransaction")) {
    const id = required(source,"id",`Line ${line}`), currency = sourceCurrency(source.currency), amount = -sourceAmount(source.amount,currency), billType = String(source.bill_type ?? (amount > 0 ? "income" : "bill"));
    const anchorDate = sourceDate(source.anchor_date ?? source.last_occurrence_date ?? source.next_expected_date ?? exportDate,`Line ${line}`);
    const destinationAccountId = optional(source.destination_account_id);
    const status = String(source.status ?? "active");
    if (billType === "transfer" && !destinationAccountId) missingDestinations++;
    if (source.holiday_calendar) holidayCalendars++;
    const maybeAmount = (value: unknown) => value === null || value === undefined ? null : Math.abs(sourceAmount(value,currency));
    const merchantId = optional(source.merchant_id), merchantName = data.merchants.find(m=>m.id===merchantId)?.name;
    const hints=source.matcher_hints==null?null:matcherJSON.parse(source.matcher_hints);
    const matching=recurringMatcherSettingsSchema.parse({enabled:false,daysEarly:Number(source.match_days_early??2),daysLate:Number(source.match_days_late??7),amountTolerancePct:String(source.amount_tolerance_pct??"7.5").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/,""),detectedName:hints?.detected_name??null,aliases:hints?.name_aliases??[],learnedTolerancePct:String(hints?.learned_tolerance_pct??"0").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/,""),sourceHints:hints});
    const lifecycle:Partial<Record<'renewsOn'|'trialEndsOn'|'cancelledOn',string>>={};
    for(const [target,key] of [['renewsOn','renews_on'],['trialEndsOn','trial_ends_on'],['cancelledOn','cancelled_on']] as const)if(source[key]!=null&&source[key]!=='')lifecycle[target]=sourceDate(source[key],`Line ${line}`);
    const observation={...(source.last_occurrence_date!=null&&source.last_occurrence_date!==''?{lastOccurrenceOn:sourceDate(source.last_occurrence_date,`Line ${line}`)}:{}),...(source.occurrence_count!=null?{occurrenceCount:recurringObservationFields.occurrenceCount.parse(Number(source.occurrence_count))}:{}),...(source.updated_at!=null?{updatedAt:sourceRecurringTimestamp(source.updated_at,`Line ${line}`)}:{})};
    data.recurringEntries.push({ ...observation,...source.manual!=null?{manual:flag(source.manual)}:{},...lifecycle,matching, id, name: typeof source.name === "string" && source.name.trim() ? source.name : merchantName ?? "Imported recurring entry", accountId: optional(source.account_id), destinationAccountId, categoryId: optional(source.category_id), merchantId, tagIds: tagsFor(source.tag_ids), amount, currency, billType: billType as "bill", status: (billType === "transfer" && !destinationAccountId && status === "active" ? "paused" : status) as "active", anchorDate, startsOn: exportDate, expectedDayOfMonth: Number(source.expected_day_of_month ?? anchorDate.slice(8)), rules: sourceRules.get(id) ?? [], endMode: String(source.end_mode ?? "never") as "never", endOn: optional(source.end_on), endAfterCount: source.end_after_count === null || source.end_after_count === undefined ? null : Number(source.end_after_count), weekendAdjust: String(source.weekend_adjust ?? "none") as "none", amountStrategy: String(source.amount_strategy ?? "fixed") as "fixed", expectedAmountMin: source.expected_amount_min!=null&&source.expected_amount_max!=null?Math.min(maybeAmount(source.expected_amount_min)!,maybeAmount(source.expected_amount_max)!):maybeAmount(source.expected_amount_min), expectedAmountMax: source.expected_amount_min!=null&&source.expected_amount_max!=null?Math.max(maybeAmount(source.expected_amount_min)!,maybeAmount(source.expected_amount_max)!):maybeAmount(source.expected_amount_max), expectedAmountAvg: maybeAmount(source.expected_amount_avg), notifyDaysBefore: Number(source.notify_days_before ?? 3), overdueGraceDays: Number(source.overdue_grace_days ?? 3), notes: typeof source.notes === "string" ? source.notes : "", paymentUrl: link(source.payment_url), autopay: flag(source.autopay) });
  }
  for (const id of sourceRules.keys()) if (!data.recurringEntries.some(r=>r.id===id)) throw new Error("A recurrence rule references a missing recurring entry.");
  for (const { data: source, line } of get("RecurringOccurrence")) {
    const currency = sourceCurrency(source.currency);
    data.recurringOccurrences.push({ id: required(source,"id",`Line ${line}`), recurringEntryId: required(source,"recurring_transaction_id",`Line ${line}`), originalDueOn: sourceDate(source.original_due_on,`Line ${line}`), dueOn: sourceDate(source.due_on,`Line ${line}`), currency, expectedAmount: source.expected_amount === null || source.expected_amount === undefined ? null : Math.abs(sourceAmount(source.expected_amount,currency)), status: required(source,"status",`Line ${line}`) as "scheduled", snoozedUntil: optional(source.snoozed_until), closedAt: optional(source.closed_at), closedSource: optional(source.closed_source), notes: typeof source.notes === "string" ? source.notes : "" });
  }
  for (const { data: source, line } of get("RecurringAllocation")) {
    const currency = sourceCurrency(source.currency), sourceCurrencyCode = source.source_currency ? sourceCurrency(source.source_currency) : null, sourceId = optional(source.transaction_id), split = data.splitLines.find(l=>l.id===sourceId);
    const confidence=source.match_confidence==null?null:Number(source.match_confidence);
    if(confidence!==null&&(!Number.isFinite(confidence)||confidence<0||confidence>1))throw new Error(`Line ${line}: invalid match confidence.`);
    const evidence=source.match_signals==null?null:matcherJSON.parse(source.match_signals);
    data.recurringAllocations.push({...confidence!==null?{matchConfidence:Math.round(confidence*10000)}:{},...evidence!==null?{matchSignals:evidence}:{},conversion:null,requestFingerprint:null, id: required(source,"id",`Line ${line}`), occurrenceId: required(source,"recurring_occurrence_id",`Line ${line}`), transactionId: split?.transactionId ?? sourceId, splitLineId: split?.id ?? null, amount: Math.abs(sourceAmount(source.allocated_amount,currency)), currency, sourceAmount: source.source_amount === null || source.source_amount === undefined ? null : Math.abs(sourceAmount(source.source_amount,sourceCurrencyCode ?? currency)), sourceCurrency: sourceCurrencyCode, state: required(source,"state",`Line ${line}`) as "confirmed", source: required(source,"source",`Line ${line}`) as "user_created", paidOn: optional(source.paid_on) });
  }
  for(const {data:source,line} of get("RecurringPriceChange")) {
    const currency=sourceCurrency(source.currency),transactionId=optional(source.transaction_id),split=data.splitLines.find(l=>l.id===transactionId);
    data.recurringPriceChanges.push({id:required(source,"id",`Line ${line}`),recurringEntryId:required(source,"recurring_transaction_id",`Line ${line}`),effectiveOn:sourceDate(source.effective_on,`Line ${line}`),previousAmount:sourceAmount(source.previous_amount,currency),newAmount:sourceAmount(source.new_amount,currency),currency,source:required(source,"source",`Line ${line}`) as "detected"|"user",transactionId:split?.transactionId??transactionId});
  }
  let missingRejectedSources=0;
  for(const {data:source,line} of get("RecurringMatchRejection")){
    const id=required(source,"id",`Line ${line}`),recurringEntryId=required(source,"recurring_transaction_id",`Line ${line}`),sourceId=optional(source.transaction_id),part=data.splitLines.find(l=>l.id===sourceId),transactionId=part?.transactionId??sourceId;
    if(!data.recurringEntries.some(e=>e.id===recurringEntryId))throw new Error(`Line ${line}: missing rejected-match schedule.`);
    if(!transactionId||!data.transactions.some(t=>t.id===transactionId)){missingRejectedSources++;continue;}
    data.recurringMatchRejections.push({id,recurringEntryId,transactionId,splitLineId:part?.id??null});
  }
  if(missingRejectedSources)warnings.push(`${missingRejectedSources} rejected match(es) have no surviving transaction source and cannot be restored. Keep the original export for that metadata.`);
  const paymentAccountCurrencies=new Map(data.accounts.map(a=>[a.id,a.currency])),paymentTransactionAccounts=new Map(data.transactions.map(t=>[t.id,t.accountId])),foreignPayments=data.recurringAllocations.filter(a=>a.transactionId&&paymentAccountCurrencies.get(paymentTransactionAccounts.get(a.transactionId)??'')!==a.currency).length;
  if(foreignPayments)warnings.push(`${foreignPayments} foreign-currency payment history record(s) retain the exported source amounts/currencies, but the export has no applied quote snapshot. Confirming a measured suggestion retains its posted ratio; an unknown source amount needs a dated quote or explicit actual account amount.`);
  if (invalidLinks) warnings.push(`${invalidLinks} unsafe or invalid website/payment URL(s) were omitted.`);
  if (missingDestinations) warnings.push(`${missingDestinations} recurring transfer(s) lack a destination in the Sure export. Active ones are paused until you select a destination.`);
  if (holidayCalendars) warnings.push(`${holidayCalendars} holiday-calendar setting(s) are not applied yet; weekday/weekend scheduling is preserved.`);
  if (data.recurringEntries.length) warnings.push("Matching settings, score evidence and usable rejected matches are retained. Matching stays off until enabled per schedule and run through review. Renewal, trial and cancellation dates are retained. Cancellation dates are records only; pause or end an active schedule to stop new reminders. Autopay is a reminder label and never initiates a payment.");
  if (data.recurringEntries.length) warnings.push(`New recurring reminders start on ${exportDate}; existing imported occurrence/payment history is retained. Payments and transactions are created only when you explicitly record them.`);
  warnings.push(`Current account balances are preserved as end-of-day snapshots on ${exportDate}. Choose the date this Sure export was created. Opening balances before the first exported snapshot are inferred.`);
  warnings.push("The pinned export omits statement files and transaction reconciliation flags. Transactions import as unreconciled; balance observations are preserved. Recheck statements after migration.");
  warnings.push("The separate attachments.json metadata manifest and original receipt bytes do not migrate through this NDJSON workflow. Keep the originals and attach them to transactions manually after import. Bank connections, credentials and household permissions do not migrate.");
  warnings.push("The pinned Sure v2 exporter does not include goals, their linked accounts or pledges. Recreate those goals after migration; they cannot be recovered from this export alone.");
  warnings.push("HSA cash-planning exclusion is retained. Account institution details and other non-loan account-specific settings are not imported yet. Account balances and supported transaction history are retained.");
  if(data.accounts.some(a=>a.loanTerms))warnings.push("Loan contract fields, rate changes and principal-only transfer choices are retained. Imported loans keep their recorded-balance accounting until loan payment replay is explicitly reviewed and enabled from a genuine origination anchor. Contractual schedules and current-balance payoff projections remain separate from recorded payments.");
  warnings.push(...importSureRules(get("Rule"),data,options.ruleCurrency));
  const supported = new Set(["RejectedTransfer","RecurringMatchRejection","RecurringPriceChange","Rule","Account", "Category", "Transaction", "Transfer", "Balance", "Valuation", "Budget", "BudgetCategory", "Tag", "Merchant", "ProviderMerchant", "RecurringTransaction", "RecurrenceRule", "RecurringOccurrence", "RecurringAllocation", "Trade", "Holding"]);
  for (const [type, count] of Object.entries(counts)) if (!supported.has(type)) warnings.push(`${count} ${type} record(s) are not imported. Keep the original export for the remaining port workflows.`);
  if(data.transferDetails.some(d=>d.status==='pending'))warnings.push("Pending transfer associations and original reporting kinds are retained for confirmation or rejection. Principal-only loan replay can use their linked payment evidence; no reporting classification is applied before confirmation.");
  if (convertedBalances) warnings.push(`${convertedBalances} converted balance snapshot(s) are omitted; account-currency balance history is retained.`);
  if(observedDifferences>10)warnings.push(`${observedDifferences} holding observations have reported totals that differ from quantity × rounded price. The first 10 are listed above; every affected row is marked in the paged conversion review.`);
  if(options.investmentRates)warnings.push(`Keeping ${data.exchangeRates.length} dated rate(s) from your current library. ${fxRows.filter(r=>r.type==='trade').length} foreign trade(s) and ${fxRows.filter(r=>r.type==='holding').length} foreign holding observation(s) use those entry-date direct/inverse rates. Sure does not export their original execution rates: review these conversions before importing. Original amounts and the applied library quote are retained; share trades remain unclassified.`);
  return { data: validateWorkspace(data), entryValuationIds:data.valuations.filter(v=>entryValuationIds.has(v.id)).map(v=>v.id), source: "sure", warnings, sourceCounts: counts,investmentFx:options.investmentRates?investmentFxReview(fxRows,data.exchangeRates.length,options.investmentReviewOffset):undefined };
}
