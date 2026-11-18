import {manualAssetCommands} from './manual-asset-schema.ts';
import {creditCardTermsCommand} from './credit-card-schema.ts';
import {CRYPTO_TAX_TREATMENTS,validSubtype} from './account-details.ts';
import {investmentReportingCommand,investmentActivitySchema} from './investment-reporting-schema.ts';
import {investmentTransferRepairCommands} from './transfer-kind-repair-schema.ts';
import {csvImportOptionsSchema} from './csv-schema.ts';
import {automaticTransferCommands} from './transfer-auto-schema.ts';
import {transferClassificationCommands} from './transfer-classification-schema.ts';
import {transferRejectionCommands} from './transfer-rejection-schema.ts';
import {transferCounterpartCommands} from './transfer-counterpart-schema.ts';
import {transferMatchCommands} from './transfer-match-schema.ts';
import {loanReplayCommands} from './loan-replay-schema.ts';
import {recurringCleanupCommands} from './recurring-cleanup-schema.ts';
import {recurringMaintenanceCommands} from "./recurring-maintenance-schema.ts";
import {recurringDetectionCommands} from "./recurring-detection-schema.ts";
import {paycheckCommands} from "./paycheck-schema.ts";
import {recurringLifecycleCommands} from "./recurring-lifecycle-schema.ts";
import {recurringMatcherCommands} from "./recurring-matcher-schema.ts";
import {recurringPriceCommands} from "./recurring-price-schema.ts";
import {loanTermsCommand} from "./loan-schema.ts";
import {marketPricingCommand} from './market-fx-schema.ts';
import {fxCommands,transferCommand} from './fx-schema.ts';
import {contributionCommands} from './contribution-schema.ts';
import {pledgeCommands} from './pledge-schema.ts';
import {reconciliationCommands} from './reconciliation-schema.ts';
import {ruleCommands} from './rule-schema.ts';
import {goalCommands} from './goal-schema.ts';
import {budgetCommands} from "./budget-schema.ts";
import {investmentCommands} from "./investment-schema.ts";
import { z } from "zod";
import { ledgerCommands } from "./ledger-commands.ts";
import { tagIdsSchema } from "./ledger-schema.ts";
import { ACCOUNT_TYPES, CURRENCIES, KINDS, validDate } from "./finance.ts";
const id = z.string().uuid();
const name = z.string().trim().min(1).max(160);
const currency = z.enum(CURRENCIES);
const date = z.string().refine(validDate, "Use a valid YYYY-MM-DD date between 1900 and 2199.");
const amount = z.number().int().safe().min(-1_000_000_000_000).max(1_000_000_000_000);
const positive = amount.refine(n => n > 0, "Amount must be positive.");
export const commandSchema = z.discriminatedUnion("action", [
  investmentReportingCommand,...investmentTransferRepairCommands,...automaticTransferCommands,...transferClassificationCommands,...transferRejectionCommands,...transferCounterpartCommands,...transferMatchCommands,...loanReplayCommands,...recurringCleanupCommands,...recurringMaintenanceCommands,...recurringDetectionCommands,...paycheckCommands,...recurringLifecycleCommands,...recurringMatcherCommands,...recurringPriceCommands,...manualAssetCommands,creditCardTermsCommand,loanTermsCommand,marketPricingCommand,...fxCommands, transferCommand, ...contributionCommands, ...pledgeCommands, ...reconciliationCommands, ...ruleCommands, ...goalCommands, ...ledgerCommands, ...investmentCommands, ...budgetCommands,
  z.object({ action: z.literal("initialize"), name, currency }),
  z.object({action:z.literal("accountArchiveDate"),accountId:id,date:date.nullable(),expectedRevision:z.number().int().safe().nonnegative()}),
  z.object({ action: z.literal("profile"), name, currency }),
  z.object({ action: z.literal("account"), subtype:z.string().refine(validSubtype).nullable().optional(),cryptoTaxTreatment:z.enum(CRYPTO_TAX_TREATMENTS).nullable().optional(),expectedRevision:z.number().int().safe().nonnegative().optional(), id: id.optional(), name, type: z.enum(ACCOUNT_TYPES), currency, openingBalance: amount, openingDate: date, archived: z.boolean().default(false), excludedFromReports: z.boolean().default(false) }),
  z.object({ action: z.literal("deleteAccount"), id }),
  z.object({ action: z.literal("category"), lucideIcon:z.string().trim().min(1).max(80).optional(), id: id.optional(), name: name.max(80), color: z.string().regex(/^#[\da-fA-F]{6}$/), parentId: id.nullable().default(null) }),
  z.object({ action: z.literal("deleteCategory"), id }),
  z.object({ action: z.literal("transaction"), investmentActivity:investmentActivitySchema, id: id.optional(), accountId: id, categoryId: id.nullable(), date, name, amount, kind: z.enum(KINDS).refine(k => ["standard", "one_time", "loan_payment", "investment_contribution"].includes(k), "Use Transfer for paired movements."), notes: z.string().trim().max(2000).default(""), excluded: z.boolean().default(false), merchantId: id.nullable().default(null), tagIds: tagIdsSchema }),
  z.object({ action: z.literal("deleteTransaction"), id }),
  z.object({ action: z.literal("valuation"), id: id.optional(), accountId: id, date, amount, name }),
  z.object({ action: z.literal("deleteValuation"), id }),
  z.object({ action: z.literal("import"), accountId: id, csv: z.string().min(1).max(1_000_000), csvOptions:csvImportOptionsSchema.optional() }),
]);
