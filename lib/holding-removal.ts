import {today,validDate,type FinanceState} from './finance.ts';
import {validateWorkspace} from './workspace.ts';
import {tradeAccountChanges,tradePositionChanges} from './trade-csv-plan.ts';
import {transferReportingEffects} from './transfer-report-effects.ts';
/** Holding#destroy_holding_and_entries!: one observation and every same-account/security trade. */
export function planHoldingRemoval(state:FinanceState,holdingId:string,asOf=today()){
 if(!state.profile)throw Error('Create your workspace first.');const reviewedOn=today();if(!validDate(asOf))throw Error('Choose a valid valuation date.');
 const holding=state.holdingSnapshots.find(h=>h.id===holdingId);if(!holding)throw Error('Holding observation not found.');const account=state.accounts.find(a=>a.id===holding.accountId),security=state.securities.find(s=>s.id===holding.securityId);if(!account||!['investment','crypto'].includes(account.type)||!security)throw Error('This holding needs an owned investment/crypto account and security.');
 const trades=state.trades.filter(t=>t.accountId===holding.accountId&&t.securityId===holding.securityId).sort((a,b)=>a.date.localeCompare(b.date)||a.sequence-b.sequence||a.id.localeCompare(b.id)),ids=new Set(trades.map(t=>t.id)),firstDate=[holding.date,...trades.map(t=>t.date)].sort()[0],lastDate=[holding.date,...trades.map(t=>t.date)].sort().at(-1)!,statements=state.accountStatements.filter(s=>s.accountId===account.id&&s.completedAt&&s.periodEnd>=firstDate),statementIds=new Set(statements.map(s=>s.id));
 const next={...state,trades:state.trades.filter(t=>!ids.has(t.id)),holdingSnapshots:state.holdingSnapshots.filter(h=>h.id!==holdingId),accountStatements:state.accountStatements.map(s=>statementIds.has(s.id)?{...s,reviewRequired:1 as const}:s)};
 validateWorkspace({...next,budgets:[]});
 const counts={holdingObservations:1,trades:trades.length,convertedTrades:trades.filter(t=>t.conversion).length,futureTrades:trades.filter(t=>t.date>reviewedOn).length,remainingHoldingObservations:next.holdingSnapshots.filter(h=>h.accountId===account.id&&h.securityId===security.id).length,closedStatements:statements.length},totals={currency:account.currency,cashAmountMinor:trades.reduce((n,t)=>n+BigInt(t.cashAmount),0n).toString(),feeMinor:trades.reduce((n,t)=>n+BigInt(t.fee),0n).toString()};
 return {next,holding,account,security,trades,counts,totals,asOf,reviewedOn,firstDate,lastDate,accounts:tradeAccountChanges(state,next,[account.id],asOf),positions:tradePositionChanges(state,next,[account.id],asOf),effects:transferReportingEffects(state,next,[{accountId:account.id,date:firstDate}],[account.id],asOf),statements:statements.map(s=>({id:s.id,title:s.title,periodStart:s.periodStart,periodEnd:s.periodEnd,reviewRequiredBefore:!!s.reviewRequired})),notes:[
  'The selected dated holding observation and ALL trades for this security in this account are removed, including earlier, later, future, imported and excluded activities.',
  'Other holding dates, other securities/accounts, security prices/splits, cash/total-balance observations, ledger transactions, files, saved goals and contribution checkpoints remain recorded. Surviving observations can keep a position or total balance visible.',
  'Valuation, cash estimates, average basis, disposal gains and linked budget/goal backing recalculate from surviving facts. Booked surviving rows and their applied foreign conversions are retained. Closed statements listed here require review.',
  'Cash/fee sums cover every deleted date and are exact signed minor-unit strings, not a current balance change or an additional fee deduction. The dated valuation figures show the actual before/after result.',
  'Saved import originals/history remain. Claims on deleted trades disappear; reimport/reversal follows each source’s existing lifecycle. Financial backup restore can recover records with new identities, without restoring import ownership.',
  'Export a complete review and financial backup before approving. This action has no dedicated undo. If a response is lost, reload the account before retrying; an applied removal makes this holding unavailable.'
 ]};
}
export type HoldingRemovalPlan=ReturnType<typeof planHoldingRemoval>;
export function holdingRemovalPage(plan:HoldingRemovalPlan,offset=0,positionOffset=0,effectOffset=0,statementOffset=0){
 const page=<T,>(rows:T[],offset:number)=>{if(!Number.isSafeInteger(offset)||offset<0||offset%25||offset>20000||offset&&offset>=rows.length)throw Error('Choose a page within this holding-removal review.');return {rows:rows.slice(offset,offset+25),offset,limit:25,total:rows.length};};
 return {holding:plan.holding,account:plan.account,security:plan.security,counts:plan.counts,totals:plan.totals,asOf:plan.asOf,reviewedOn:plan.reviewedOn,firstDate:plan.firstDate,lastDate:plan.lastDate,trades:page(plan.trades,offset),accounts:plan.accounts,positions:page(plan.positions,positionOffset),effects:page(plan.effects,effectOffset),statements:page(plan.statements,statementOffset),notes:plan.notes};
}
export function* holdingRemovalCSVRows(p:HoldingRemovalPlan,revision:number,receipt:string):Generator<(string|number)[]>{
 yield ['Sure holding and trade removal review',p.holding.id,revision,receipt,p.reviewedOn,p.asOf];yield ['Scope',p.account.id,p.account.name,p.security.id,p.security.ticker,p.security.exchange,p.firstDate,p.lastDate];yield ['Counts',JSON.stringify(p.counts)];yield ['Exact deleted-date totals',p.totals.currency,p.totals.cashAmountMinor,p.totals.feeMinor];
 yield ['record_type','id','account_id','security_id','date','name','activity','qty','currency','cash_amount_minor','fee_minor','price','holding_amount_minor','cost_basis','conversion_json','original_json'];
 const h=p.holding;yield ['holding',h.id,h.accountId,h.securityId,h.date,'','',''+h.qty,h.currency,'','',h.price,h.amount,h.costBasis??'',h.conversion?JSON.stringify(h.conversion):'',JSON.stringify(h)];
 for(const t of p.trades)yield ['trade',t.id,t.accountId,t.securityId,t.date,t.name,t.activity,t.qty,t.currency,t.cashAmount,t.fee,t.price,'','',t.conversion?JSON.stringify(t.conversion):'',JSON.stringify(t)];
 yield ['account_effect_json'];for(const a of p.accounts)yield [JSON.stringify(a)];yield ['position_effect_json'];for(const position of p.positions)yield [JSON.stringify(position)];yield ['budget_goal_effect_json'];for(const e of p.effects)yield [JSON.stringify(e)];yield ['completed_statement_json'];for(const s of p.statements)yield [JSON.stringify(s)];yield ['note'];for(const note of p.notes)yield [note];
}
