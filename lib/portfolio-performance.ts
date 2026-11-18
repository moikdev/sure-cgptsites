import {CURRENCIES,sumMinorUnits,today,validDate,type FinanceState} from './finance.ts';
import {decimalAtoms,QTY_SCALE,roundDivide,safeMinorUnits} from './decimal.ts';
import {accountPositions,investmentAccountBalance,type Position} from './portfolio.ts';
import {createPortfolioFlowReport,type PortfolioFlowOptions} from './portfolio-flows.ts';
import {toCSV} from './csv.ts';

export interface PerformanceIssue {accountId:string;date:string;code:'opening'|'holding_observation'|'security_movement'|'unclassified';message:string;}
const previousDay=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const evidence=(positions:Position[])=>positions.filter(p=>p.qty!=='0').map(p=>({securityId:p.securityId,qty:p.qty,value:p.value,price:p.price,priceDate:p.priceDate,...(p.priceConversion?{conversion:p.priceConversion}:{})}));
// Balance::BaseCalculator#market_value_change_on_date, telescoped over a
// period: delta holdings + actual cash of nonzero-share trades. Entry signs
// in this port are the inverse of Rails Entry#amount. Never substitute trade
// notional, external-flow totals, or cost basis for this cash.
export function recordedMarketChange(openingHoldings:number,closingHoldings:number,securityTradeCash:number){return safeMinorUnits(BigInt(closingHoldings)-BigInt(openingHoldings)+BigInt(securityTradeCash));}
// InvestmentStatement#period_return_trend and Trend#percent use the portfolio
// value strictly before the period and the magnitude of that denominator.
export function marketChangePercent(change:number,openingTotal:number){if(openingTotal===0)return null;const rounded=Number(roundDivide(BigInt(change)*1000n,BigInt(openingTotal)<0n?-BigInt(openingTotal):BigInt(openingTotal)))/10;return rounded===0&&change<0?-0:rounded;}

export function createPortfolioPerformanceReport(state:FinanceState,options:PortfolioFlowOptions){
 if(!CURRENCIES.includes(options.currency)||!validDate(options.from)||!validDate(options.to)||options.from>options.to||options.to>today())throw new Error('Choose a valid date range through today.');
 const eligible=state.accounts.filter(a=>['investment','crypto'].includes(a.type)&&a.currency===options.currency);
 if(options.accountId&&!eligible.some(a=>a.id===options.accountId))throw new Error('Investment account not found in this currency.');
 const accounts=eligible.filter(a=>(options.accountId?a.id===options.accountId:!a.excludedFromReports)&&a.openingDate<=options.to).sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id)),openingDate=previousDay(options.from),issues:PerformanceIssue[]=[];
 const rows=accounts.map(account=>{
  const inPeriod=(date:string)=>date>=options.from&&date<=options.to&&date>=account.openingDate,opening=investmentAccountBalance(account,state,openingDate),closing=investmentAccountBalance(account,state,options.to),trades=state.trades.filter(t=>t.accountId===account.id&&inPeriod(t.date)),securityTrades=trades.filter(t=>decimalAtoms(t.qty,QTY_SCALE)!==0n),securityTradeCash=sumMinorUnits(securityTrades.map(t=>t.cashAmount));
  const add=(code:PerformanceIssue['code'],date:string,message:string)=>issues.push({accountId:account.id,date,code,message});
  if(account.openingDate>=options.from)add('opening',account.openingDate,'This account opens within the period; there is no pre-period capital baseline for it.');
  for(const h of state.holdingSnapshots.filter(h=>h.accountId===account.id&&inPeriod(h.date)))add('holding_observation',h.date,'A holding observation can change shares or value without a matching trade. Review it before treating the recorded market change as performance.');
  for(const t of securityTrades)if(['transfer_in','transfer_out','sweep_in','sweep_out','reinvestment'].includes(t.activity)||t.cashAmount===0)add('security_movement',t.date,'A security movement or reinvestment can appear in market change without matching purchase or sale cash.');
  for(const t of trades)if(t.activity==='unclassified'||t.activity==='cash'||t.activity==='other'||t.activity==='exchange')add('unclassified',t.date,['other','exchange'].includes(t.activity)?'Review the paired events and economic meaning of this Exchange or Other activity before relying on performance.':'An imported or generic activity has not been classified; review its economic meaning.');
  const marketChange=recordedMarketChange(opening.holdings,closing.holdings,securityTradeCash),accountIssues=issues.filter(i=>i.accountId===account.id),observations=state.valuations.filter(v=>v.accountId===account.id&&inPeriod(v.date)).length+state.investmentCashBalances.filter(v=>v.accountId===account.id&&inPeriod(v.date)).length;
  return {accountId:account.id,accountName:account.name,archived:!!account.archived,excludedFromReports:!!account.excludedFromReports,opening,closing,totalChange:safeMinorUnits(BigInt(closing.total)-BigInt(opening.total)),securityTradeCash,securityTradeCount:securityTrades.length,excludedTradeCount:trades.filter(t=>t.excluded).length,marketChange,percent:accountIssues.length?null:marketChangePercent(marketChange,opening.total),issueCount:accountIssues.length,balanceObservations:observations,openingQuotes:account.openingDate>openingDate?[]:evidence(accountPositions(state,account,openingDate)),closingQuotes:evidence(accountPositions(state,account,options.to))};
 });
 const sum=(pick:(row:typeof rows[number])=>number)=>sumMinorUnits(rows.map(pick)),opening={cash:sum(r=>r.opening.cash),holdings:sum(r=>r.opening.holdings),total:sum(r=>r.opening.total)},closing={cash:sum(r=>r.closing.cash),holdings:sum(r=>r.closing.holdings),total:sum(r=>r.closing.total)},marketChange=sum(r=>r.marketChange),flows=createPortfolioFlowReport(state,options);
 return {options,revision:state.profile?.revision??0,openingDate,method:'sure_recorded_market_change' as const,opening,closing,totalChange:safeMinorUnits(BigInt(closing.total)-BigInt(opening.total)),securityTradeCash:sum(r=>r.securityTradeCash),marketChange,percent:issues.length?null:marketChangePercent(marketChange,opening.total),sourcePercent:marketChangePercent(marketChange,opening.total),issues,warnings:[
  'Recorded market change = closing holdings − pre-period holdings + signed cash of nonzero-share trades. This follows Sure’s balance calculation. It is not an annualized, money-weighted or time-weighted total return.',
  'Cash deposits, withdrawals, dividends, interest and standalone fees do not enter recorded market change. Fees embedded in purchase or sale cash do. Reported income, fees and external cash below follow flow exclusions and labels separately.',
  'Balances and market change include excluded entries, as in Sure’s balance engine. Exclusions affect the separate flow totals; they never remove physical shares or cash.',
  'Percent uses market change divided by the magnitude of total portfolio value strictly before the period, rounded to one decimal. A zero baseline has no percentage. History review issues withhold the displayed percentage; the calculation notes retain the unqualified arithmetic for inspection.',
  'Manual quotes carry forward from their recorded dates. Opening and closing quote evidence is included per account. Missing required prices or exchange rates reject this report; no 1:1 conversion is inferred.',
  'Total balance change may include opening balances and cash/total observations. It is not profit. A holding observation or security movement can mix contributions into recorded market change, even when cost basis is known.',
 ],reportedCash:{externalIn:flows.totals.external_inflow.netCash,externalOut:flows.totals.external_outflow.netCash,income:flows.totals.income.netCash,fees:flows.totals.fee.netCash},rows};
}
export type PortfolioPerformanceReport=ReturnType<typeof createPortfolioPerformanceReport>;
export function portfolioPerformancePage(report:PortfolioPerformanceReport,offset=0){if(!Number.isSafeInteger(offset)||offset<0||offset>40000)throw new Error('Choose supported performance page options.');return {...report,rows:report.rows.slice(offset,offset+25),page:{offset,limit:25,total:report.rows.length}};}
export function portfolioPerformanceCSV(report:PortfolioPerformanceReport){return toCSV([
 ['from','through','opening_date','currency','account','opening_total_minor_units','closing_total_minor_units','total_change_minor_units','opening_holdings_minor_units','closing_holdings_minor_units','security_trade_cash_minor_units','recorded_market_change_minor_units','displayed_percent','review_issues','cash_or_total_observations','excluded_trades_in_balance'],
 ...report.rows.map(r=>[report.options.from,report.options.to,report.openingDate,report.options.currency,r.accountName,r.opening.total,r.closing.total,r.totalChange,r.opening.holdings,r.closing.holdings,r.securityTradeCash,r.marketChange,r.percent??'',report.issues.filter(i=>i.accountId===r.accountId).map(i=>i.date+': '+i.message).join(' | '),r.balanceObservations,r.excludedTradeCount]),
 ]);}
