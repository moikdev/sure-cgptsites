import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountBalance, balance, sumMinorUnits, monthlySummary, transferKind, type Account } from "../lib/finance.ts";
import { parseSitesBackup, remapWorkspace, validateWorkspace, workspaceState, workspaceSummary } from "../lib/workspace.ts";
import { parseSureExport, sourceAmount } from "../lib/sure-export.ts";
const fixture = readFileSync(new URL("./fixtures/sure-v2.ndjson", import.meta.url), "utf8");
const options = { exportDate: "2026-02-28", name: "Imported user", currency: "USD" as const };
const native = () => parseSureExport(fixture, options);
const backup = () => ({ format: "sure-sites", version: 2, ...workspaceState(native().data) });
test("native export preserves signs, debt, currencies and exact snapshot balances", () => {
  const imported = native(), state = workspaceState(imported.data), accounts = new Map(state.accounts.map(a => [a.id, a]));
  assert.equal(state.transactions.find(t => t.id === "expense")!.amount, -10025);
  assert.equal(state.transactions.find(t => t.id === "income")!.amount, 50000);
  assert.equal(state.transactions.find(t => t.id === "card-expense")!.amount, -1025);
  assert.equal(accountBalance(accounts.get("bank")!, state, "2026-02-28"), 90075);
  assert.equal(accountBalance(accounts.get("card")!, state, "2026-02-28"), -10025);
  assert.equal(accountBalance(accounts.get("yen")!, state, "2026-02-28"), 25000);
  assert.equal(accounts.get("yen")!.type, "savings"); assert.equal(accounts.get("yen")!.archived, 1); assert.equal(accounts.get("yen")!.excludedFromReports, 1);
  const summary = monthlySummary(state, "USD", "2026-02", "2026-02-28");
  assert.equal(summary.expenses, 11025); assert.equal(summary.income, 50000); assert.equal(summary.netWorth, 80050);
  assert.equal(monthlySummary(state, "JPY", "2026-02", "2026-02-28").netWorth, 0);
});
test("native balance history and end-of-day reconciliation do not replay same-day flows", () => {
  const state = workspaceState(native().data), account = state.accounts.find(a => a.id === "bank")!;
  assert.equal(accountBalance(account, state, "2026-02-01"), 100000);
  assert.equal(accountBalance(account, state, "2026-02-02"), 89975);
  assert.equal(accountBalance(account, state, "2026-02-03"), 139975);
  assert.equal(accountBalance(account, state, "2026-02-28"), 90075);
});
test("transfers remain paired, have upstream kind semantics, and do not inflate spending", () => {
  const data = native().data, legs = data.transactions.filter(t => t.transferId === "pair");
  assert.equal(legs.length, 2); assert.equal(legs.reduce((sum, t) => sum + t.amount, 0), 0);
  assert.equal(legs.find(t => t.amount > 0)!.kind, "funds_movement"); assert.equal(legs.find(t => t.amount < 0)!.kind, "cc_payment");
  assert.equal(transferKind("investment", "crypto"), "funds_movement"); assert.equal(transferKind("checking", "crypto"), "investment_contribution"); assert.equal(transferKind("checking", "other_liability"), "cc_payment");
});
test("splits, category parents and supported budgets migrate with visible limitations", () => {
  const result = native();
  assert.equal(result.data.splitLines.reduce((s,t) => s+t.amount,0), -1000);
  assert.equal(result.data.categories.find(c => c.id === "groceries")!.parentId, "food");
  assert.equal(result.data.budgetPeriods.length, 1); assert.equal(result.data.budgetEnvelopes.length, 2); assert.equal(result.data.budgetEnvelopes.find(e=>e.categoryId==="utilities")!.allocated, 10000); assert.equal(result.data.budgetEnvelopes.find(e=>e.categoryId==="food")!.allocated, 20000);
  assert.equal(result.data.transactions.find(t => t.id === "split")!.amount, -1000); assert.equal(result.data.tags.length, 1); assert.equal(result.data.merchants.length, 1); assert.equal(result.data.transactions.find(t => t.id === "expense")!.tagIds[0], "tag"); assert.ok(result.warnings.some(w => w.includes("rollover choices")));
});
test("Sites v1 and v2 backups round trip supported records without trusting owner fields", () => {
  const original = backup(), v2 = parseSitesBackup(JSON.stringify(original)).data;
  assert.deepEqual(parseSitesBackup(JSON.stringify({ ...original, version: 1 })).data, v2);
  const remapped = remapWorkspace(v2);
  assert.deepEqual(workspaceSummary(remapped,"2026-02-28").balances,workspaceSummary(v2,"2026-02-28").balances);
  assert.ok(remapped.accounts.every(a => !v2.accounts.some(old => old.id === a.id)));
  assert.ok(!JSON.stringify(remapped).includes('"ownerId"'));
  const remappedCategories = new Map(remapped.categories.map(c => [c.id,c]));
  assert.ok(remapped.categories.filter(c=>c.parentId).every(c=>remappedCategories.has(c.parentId!)));
  assert.equal(new Set(remapped.transactions.filter(t=>t.transferId).map(t=>t.transferId)).size,1);
});
test("legacy Sites backups get compatible defaults",()=>{
  const value=backup(); const raw=JSON.parse(JSON.stringify(value)); delete raw.valuations; raw.categories.forEach((c:Record<string,unknown>)=>delete c.parentId); raw.transactions.forEach((t:Record<string,unknown>)=>delete t.excluded); raw.accounts.forEach((a:Record<string,unknown>)=>delete a.excludedFromReports);
  const parsed=parseSitesBackup(JSON.stringify(raw)).data;assert.equal(parsed.valuations.length,0);assert.ok(parsed.transactions.every(t=>t.excluded===0));assert.ok(parsed.accounts.every(a=>a.excludedFromReports===0));
});
test("corrupt backups reject orphaned references, cycles, duplicate keys and unbalanced transfers",()=>{
  const original=backup();
  const bad=(change:(v:ReturnType<typeof backup>)=>void)=>{const v=structuredClone(original);change(v);assert.throws(()=>parseSitesBackup(JSON.stringify(v)));};
  bad(v=>v.transactions[0].accountId="missing");bad(v=>v.transactions[0].categoryId="missing");bad(v=>v.categories[0].parentId=v.categories[0].id);
  bad(v=>v.transactions.push({...v.transactions[0]}));bad(v=>v.transactions.find(t=>t.transferId)!.amount--);bad(v=>v.valuations.push({...v.valuations[0],id:"duplicate-date"}));
  bad(v=>v.transactions.find(t=>t.transferId)!.transferId=null);bad(v=>v.accounts[0].openingBalance=Number.MAX_SAFE_INTEGER);
  assert.throws(()=>parseSitesBackup(JSON.stringify({...original,version:99})));assert.throws(()=>parseSitesBackup("{"));
});
test("native export rejects malformed lines instead of silently dropping them",()=>{
  assert.throws(()=>parseSureExport(fixture+"\n{broken",options),/Line/);
  assert.throws(()=>parseSureExport(fixture+"\n"+fixture.split("\n")[0],options),/Duplicate Account/);
  assert.throws(()=>parseSureExport(fixture.replace('"account_id":"bank"','"account_id":"missing"'),options),/missing account/);
  assert.throws(()=>parseSureExport(fixture.replace('"amount":"50.00"','"amount":"51.00"'),options),/equal and opposite/);
  assert.throws(()=>parseSureExport(fixture.replace('"amount":"3.00"','"amount":"4.00"'),options),/Split lines/);
});
test("native decimal precision is checked rather than rounded",()=>{assert.equal(sourceAmount("25.0000","JPY"),25);assert.equal(sourceAmount("25.1200","USD"),2512);assert.equal(sourceAmount("1.234","KWD"),1234);assert.throws(()=>sourceAmount("1.001","USD"));assert.throws(()=>sourceAmount("NaN","USD"));});
test("valuation-only assets ignore transactions; future snapshots do not apply early",()=>{
  const state=workspaceState(native().data),account={...state.accounts[0],type:"property"} as Account;
  assert.equal(balance(account,state.transactions,"2026-02-03",state.valuations),100000);
  assert.equal(balance(account,state.transactions,"2026-02-28",state.valuations),90075);
});
test("preview totals are derived from validated data and preserve excluded transaction status",()=>{const value=native().data;assert.equal(validateWorkspace(value).transactions.find(t=>t.id==="card-expense")!.excluded,1);const summary=workspaceSummary(value,"2026-02-28");assert.equal(summary.counts.transferPairs,1);assert.equal(summary.counts.transactions,6);});

test("large offsetting ledger flows retain the last minor unit exactly",()=>{const values=[...Array(10000).fill(1_000_000_000_000),1,...Array(10000).fill(-1_000_000_000_000)];assert.equal(sumMinorUnits(values),1);assert.throws(()=>sumMinorUnits([Number.MAX_SAFE_INTEGER,1]),/integer range/);});
test("restore rejects a scheduled ledger that would exceed integer report limits later",()=>{const value=native().data;value.splitLines=[];value.transactions=Array.from({length:10000},(_,i)=>({...value.transactions[0],id:`future-${i}`,date:'2099-01-01',amount:1_000_000_000_000,kind:'one_time' as const,transferId:null}));assert.throws(()=>validateWorkspace(value),/integer range/);});
