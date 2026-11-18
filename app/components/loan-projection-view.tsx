"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { money, parseMoney, today, type FinanceState } from "../../lib/finance";
import { createLoanProjectionReport, loanProjectionPage, loanProjectionCSV, type LoanProjectionPage, type LoanProjectionOptions } from "../../lib/loan-projection";
import { download } from "./forms";

export function LoanProjectionView({ state, accountId, demo, termsDirty }: { state: FinanceState; accountId: string; demo: boolean; termsDirty: boolean }) {
  const account = state.accounts.find(a => a.id === accountId)!;
  const [asOf, setAsOf] = useState(today()), [extra, setExtra] = useState(""), [frequency, setFrequency] = useState<LoanProjectionOptions["frequency"]>("monthly");
  const [report, setReport] = useState<LoanProjectionPage | null>(null), [series, setSeries] = useState<"baseline" | "scenario">("baseline");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [stale, setStale] = useState(false);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const clear = () => { sequence.current++; controller.current?.abort(); setReport(null); setError(""); setStale(false); setBusy(false); };
  useEffect(() => {
    clear();
    return () => { sequence.current++; controller.current?.abort(); };
  }, [state.profile?.revision, accountId, termsDirty]);
  const readOptions = (): LoanProjectionOptions => {
    const input = extra.trim();
    if (input && !/^\d+(?:\.\d+)?$/.test(input)) throw new Error("Enter a nonnegative extra amount in plain decimal notation.");
    return { asOf, extraAmount: input ? parseMoney(input, account.currency) : 0, frequency };
  };
  const run = async (options: LoanProjectionOptions, offset = 0, csv = false, expectedRevision = state.profile!.revision) => {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const current = ++sequence.current; setBusy(true); setError(""); setStale(false);
    try {
      if (demo) {
        const full = createLoanProjectionReport(state, accountId, options, expectedRevision);
        if (csv) download("sure-loan-projection.csv", loanProjectionCSV(full), "text/csv;charset=utf-8");
        else setReport(loanProjectionPage(full, offset));
      } else {
        const params = new URLSearchParams({ accountId, asOf: options.asOf, extraAmount: String(options.extraAmount), frequency: options.frequency, offset: String(offset), expectedRevision: String(expectedRevision), format: csv ? "csv" : "json" });
        const response = await fetch(`/api/loan-projection?${params}`, { cache: "no-store", signal: abort.signal });
        if (!response.ok) {
          const data = await response.json() as { error?: string };
          if (current !== sequence.current) return;
          if (response.status === 409) setStale(true);
          throw new Error(data.error ?? "The projection could not be calculated.");
        }
        if (csv) {
          const content = new TextDecoder("utf-8",{ignoreBOM:true}).decode(await response.arrayBuffer()); if (current !== sequence.current) return;
          download("sure-loan-projection.csv", content, "text/csv;charset=utf-8");
        } else {
          const result = await response.json() as LoanProjectionPage;
          if (current !== sequence.current) return;
          setReport(result);
        }
      }
    } catch (error) {
      if (current !== sequence.current) return;
      setReport(null); setError(error instanceof Error ? error.message : "Check the projection options.");
    } finally { if (current === sequence.current) setBusy(false); }
  };
  const calculate = (event: FormEvent) => {
    event.preventDefault(); setReport(null);
    try { const options = readOptions(); setSeries(options.extraAmount ? "scenario" : "baseline"); void run(options); }
    catch (error) { setError(error instanceof Error ? error.message : "Check the extra amount."); }
  };
  const selected = report?.[series] ?? report?.baseline;
  const earliest = account.loanTerms?.startDate && account.loanTerms.startDate > account.openingDate ? account.loanTerms.startDate : account.openingDate;
  return <section className="loan-schedule" aria-labelledby="loan-projection-heading"><h3 id="loan-projection-heading">Payoff and extra repayments</h3>
    <p className="form-hint">Use the account’s debt on a chosen date under its selected accounting, and the saved contract’s remaining payments. The original maturity stays fixed. Insurance and fees are excluded from these principal-and-interest projections. Nothing is saved or paid by calculating a scenario.</p>
    {termsDirty && <p className="budget-callout">Save your edited loan terms before calculating a payoff projection.</p>}
    <form onSubmit={calculate} onChange={clear}><div className="form-grid"><label>Recorded balance date<input type="date" required min={earliest} max={today()} value={asOf} disabled={busy || termsDirty} onChange={e => setAsOf(e.target.value)} /></label><label>Extra amount ({account.currency})<input inputMode="decimal" placeholder="0.00" value={extra} disabled={busy || termsDirty} onChange={e => setExtra(e.target.value)} /></label></div><label>Extra frequency<select value={frequency} disabled={busy || termsDirty} onChange={e => setFrequency(e.target.value as typeof frequency)}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="fortnightly">Every two weeks</option></select></label><p className="form-hint">Weekly and two-week extras start the day after the selected date and count through each payment date. Interest is charged monthly on the opening balance; mid-period extras start saving interest in the next period.</p><button className="button" disabled={busy || termsDirty || earliest > today()}>{busy ? "Calculating…" : "Calculate projection"}</button></form>
    {error && <p className="form-error" role="alert">{error}</p>}{stale && <button className="button" onClick={() => location.reload()}>Reload workspace</button>}
    {report && <><p className="form-hint">{state.accounts.find(a=>a.id===accountId)?.loanReplay===1?'Replayed principal balance':'Recorded balance'} on {report.options.asOf}: {money(report.recordedBalance, report.currency)} · Saved contract · Principal and interest only.</p><div className="loan-projection-comparison">{([['baseline', 'Contracted payments'], ['scenario', 'With extra repayments']] as const).map(([key, title]) => {
      const projection = report[key]; if (!projection) return null;
      return <article className="loan-projection-card" key={key}><h4>{title}</h4>
        {projection.status === "settled" ? <p>The account balance is zero or a credit. There is no debt to project.</p> : projection.status === "missing_terms" ? <p>Complete and save original principal, origination, term, annual rate and rate type first.</p> : projection.status === "matured" ? <p>The contract has no payments after this date. {money(projection.currentPrincipal, report.currency)} is still owed under the selected accounting.</p> : projection.status === "zero_payment" ? <p>The remaining contracted payment rounds to zero. A payoff date cannot be projected.</p> : <><p>{projection.converged ? `Projected payoff: ${projection.payoffDate}` : `Payments do not clear the debt by ${projection.maturity}.`}</p><dl className="loan-totals"><div><dt>Interest charged</dt><dd>{money(projection.totalInterest, report.currency)}</dd></div><div><dt>{projection.converged ? "Remaining principal + interest" : "Projected installments"}</dt><dd>{money(projection.totalCost ?? projection.totalPayments, report.currency)}</dd></div><div><dt>Additional amount applied</dt><dd>{money(projection.totalExtra, report.currency)}</dd></div><div><dt>Still owed at maturity</dt><dd>{money(projection.balloonAmount, report.currency)}</dd></div></dl></>}
      </article>;
    })}</div>
    {report.comparison?.interestSaved !== null && report.comparison && <p className="budget-callout">Compared with contracted payments from this same recorded balance: {report.comparison.monthsSooner} monthly periods sooner and {money(report.comparison.interestSaved, report.currency)} less interest. Both projections clear the debt.</p>}
    {report.scenario?.converged && report.baseline.applicable && !report.baseline.converged && <p className="budget-callout">The extra scenario clears the debt by the original maturity. Contracted payments alone leave {money(report.baseline.balloonAmount, report.currency)} owed, so a payoff-time or total-cost saving cannot be compared.</p>}
    {selected && report.totalRows > 0 && <><div className="form-actions"><button type="button" className="button" disabled={busy || series === "baseline"} onClick={() => { setSeries("baseline"); if (report.offset) void run(report.options, 0, false, report.revision); }}>Contracted payments</button>{report.scenario && <button type="button" className="button" disabled={busy || series === "scenario"} onClick={() => { setSeries("scenario"); if (report.offset) void run(report.options, 0, false, report.revision); }}>With extras</button>}<button className="text-button" disabled={busy} onClick={() => void run(report.options, 0, true, report.revision)}><Download size={14} />Download both complete projections</button></div><div className="table-wrap"><table><caption className="sr-only">Projected {series === "scenario" ? "extra" : "contracted"} payments in {report.currency}, excluding insurance and fees</caption><thead><tr><th>Date</th><th>Annual rate</th><th>Payment</th><th>Extra applied</th><th>Principal</th><th>Interest</th><th>Balance</th></tr></thead><tbody>{selected.payments.map(row => <tr key={row.number}><th scope="row">{row.date}</th><td>{row.accrualRate}%</td><td>{money(row.payment, report.currency)}</td><td>{money(row.appliedExtra, report.currency)}</td><td>{money(row.principal, report.currency)}</td><td>{money(row.interest, report.currency)}</td><td>{money(row.endingBalance, report.currency)}</td></tr>)}</tbody></table></div><div className="table-footer"><span>{selected.rowCount ? report.offset + 1 : 0}–{Math.min(selected.rowCount, report.offset + report.limit)} of {selected.rowCount}</span><div><button className="icon-button" aria-label="Previous projection page" disabled={busy || !report.offset} onClick={() => void run(report.options, Math.max(0, report.offset - report.limit), false, report.revision)}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="Next projection page" disabled={busy || report.offset + report.limit >= selected.rowCount} onClick={() => void run(report.options, report.offset + report.limit, false, report.revision)}><ChevronRight size={16} /></button></div></div></>}
    </>}
  </section>;
}
