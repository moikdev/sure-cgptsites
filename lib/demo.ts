import {normalizeLegacyBudgets} from "./budget";
import { DEFAULT_CATEGORIES, type FinanceState } from "./finance";
export function demoState(): FinanceState {
  const ownerId = "sample", now = new Date(), year = now.getUTCFullYear(), month = now.getUTCMonth();
  const date = (offset: number, day: number) => new Date(Date.UTC(year, month + offset, day)).toISOString().slice(0, 10);
  const categories = DEFAULT_CATEGORIES.map(([name, color], i) => ({ id: `category-${i}`, ownerId, name, color }));
  const accounts: FinanceState["accounts"] = [
    { id: "checking", ownerId, name: "Everyday checking", type: "checking", currency: "USD", openingBalance: 620000, openingDate: date(-6, 1), archived: 0 },
    { id: "savings", ownerId, name: "Rainy day fund", type: "savings", currency: "USD", openingBalance: 1850000, openingDate: date(-6, 1), archived: 0 },
    { id: "investment", ownerId, name: "Long-term investments", type: "investment", currency: "USD", openingBalance: 3240000, openingDate: date(-6, 1), archived: 0 },
    { id: "credit", creditCardTerms:{availableCredit:500000,minimumPayment:2500,annualFee:0,apr:"18.99",expirationDate:null,statementCloseDay:10,dueDay:26}, ownerId, name: "Everyday credit card", type: "credit", currency: "USD", openingBalance: -124500, openingDate: date(-6, 1), archived: 0 },
  ];
  const transactions: FinanceState["transactions"] = [];
  for (let offset = -5; offset <= 0; offset++) {
    const entries: [number, string, number, number][] = [[1, "Monthly salary", 540000, 0], [2, "Apartment rent", -165000, 1], [4, "Whole Foods Market", -12480, 2], [6, "Neighborhood café", -1860, 3], [8, "Train pass", -9500, 4], [10, "Internet & electricity", -14200, 8], [12, "Sunday groceries", -8640, 2], [17, "Dinner with friends", -7250, 3], [20, "Bookshop", -4200, 7], [23, "Weekend groceries", -10930, 2]];
    for (const [day, name, amount, category] of entries) {
      const d = date(offset, day); if (d > now.toISOString().slice(0, 10)) continue;
      transactions.push({ id: `sample-${offset}-${day}`, ownerId, accountId: "checking", categoryId: categories[category].id, date: d, name, amount, kind: "standard", transferId: null, notes: "Sample transaction", importKey: null });
    }
    if (date(offset, 5) <= now.toISOString().slice(0, 10)) {
      for (const [accountId, amount] of [["checking", -80000], ["savings", 80000]] as const) transactions.push({ id: `transfer-${offset}-${accountId}`, ownerId, accountId, categoryId: null, date: date(offset, 5), name: "Monthly savings", amount, kind: "funds_movement", transferId: `sample-transfer-${offset}`, notes: "", importKey: null });
    }
  }
  return normalizeLegacyBudgets({ transferMatchRejections:[],recurringMatchRejections:[], recurringPriceChanges:[], exchangeRates:[],transferDetails:[],transferFees:[],contributionBalances:[],goalPledges:[],transactionReceipts:[],statementFiles:[], accountStatements:[], rules:[],ruleRuns:[], goals:[{id:"sample-reserve",ownerId,name:"Emergency reserve",currency:"USD",targetAmount:1500000,targetDate:null,kind:"maintained",state:"active",targetMode:"fixed",targetMonths:null,consumedAmount:0,completedAmount:null,completedAt:null,color:"#14b8a6",notes:"Sample goal"}],goalAccounts:[{id:"sample-goal-link",ownerId,goalId:"sample-reserve",accountId:"savings",allocatedAmount:1500000}],goalConsumptions:[], budgetBooks:[],budgetPeriods:[],budgetEnvelopes:[], securities:[],securityPrices:[],trades:[],holdingSnapshots:[],securitySplits:[],investmentCashBalances:[], tags: [], merchants: [], splitLines: [], recurringEntries: [], recurringOccurrences: [], recurringAllocations: [], valuations: [], profile: { ownerId, name: "Alex", currency: "USD", revision: 0 }, accounts, categories, transactions: transactions.sort((a, b) => b.date.localeCompare(a.date)), budgets: [[1, 170000], [2, 55000], [3, 25000], [4, 15000], [5, 20000], [7, 10000], [8, 20000]].map(([cat, amount]) => ({ id: `budget-${cat}`, ownerId, categoryId: categories[cat].id, month: date(0, 1).slice(0, 7), currency: "USD", amount })) });
}
