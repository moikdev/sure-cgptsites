"use client";
import {LoanReplayView} from "./loan-replay-view";
import {LoanProjectionView} from "./loan-projection-view";
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Plus, Trash2 } from "lucide-react";
import { accountBalance, money, moneyInput, parseMoney, today, type Account, type FinanceState } from "../../lib/finance";
import { loanTermsSchema } from "../../lib/loan-schema";
import { loanSchedule } from "../../lib/loans";
import type { LoanTerms } from "../../lib/loan-types";
import { toCSV } from "../../lib/csv";
import { download, type Submit } from "./forms";

export function LoanForm({ account, state, submit, disabled, onRemove, demo,onBusy,onChanged }: { onBusy:(value:boolean)=>void;onChanged:()=>Promise<void>;demo:boolean; onRemove:()=>void; account: Account; state: FinanceState; submit: Submit; disabled: boolean }) {
  const [termsDirty,setTermsDirty] = useState(false);
  const terms = account.loanTerms, ref = useRef<HTMLFormElement>(null);
  const [rateType, setRateType] = useState(terms?.rateType ?? "");
  const [changes, setChanges] = useState(terms?.rateChanges ?? []);
  const [preview, setPreview] = useState(() => terms ? loanSchedule(terms) : null), [issue, setIssue] = useState(""), [page, setPage] = useState(0);
  const invalidate = () => { setTermsDirty(true); setPreview(null); setIssue(""); setPage(0); };
  const build = (form: FormData): LoanTerms => {
    const nullable = (name: string) => String(form.get(name) ?? "").trim() || null;
    const amount = (name: string) => nullable(name) === null ? null : parseMoney(nullable(name)!, account.currency);
    const parsed = loanTermsSchema.safeParse({ subtype: nullable("subtype"), initialBalance: amount("principal"), startDate: nullable("startDate"), termMonths: nullable("term") === null ? null : Number(nullable("term")), annualRate: nullable("rate"), rateType: rateType || null, rateChanges: changes, dayCount: form.get("dayCount"), downPayment: amount("deposit"), insuranceRate: nullable("insuranceRate"), insuranceType: nullable("insuranceType"), principalOnlyTransfers: form.get("principalOnlyTransfers")==="on" });
    if (!parsed.success) throw new Error(parsed.error.issues.map(i => i.message).join(" "));
    loanSchedule(parsed.data);
    return parsed.data;
  };
  const check = () => {
    if (!ref.current?.reportValidity()) return;
    try {
      const result = loanSchedule(build(new FormData(ref.current)));
      setPreview(result); setPage(0);
      setIssue(result ? "" : "Record original principal, origination, term, annual rate and rate type to calculate a schedule.");
    } catch (error) { setPreview(null); setIssue(error instanceof Error ? error.message : "Check the loan terms."); }
  };
  const exportSchedule = () => {
    if (!preview) return;
    const rows = preview.payments.map(p => [p.number, p.date, account.currency, moneyInput(p.openingBalance, account.currency), p.accrualRate, p.sizingRate, moneyInput(p.payment, account.currency), moneyInput(p.principal, account.currency), moneyInput(p.interest, account.currency), moneyInput(p.insurance, account.currency), moneyInput(p.total, account.currency), moneyInput(p.endingBalance, account.currency)]);
    download("sure-loan-schedule.csv", toCSV([["period", "date", "currency", "opening_balance", "accrual_rate_percent", "sizing_rate_percent", "payment", "principal", "interest", "insurance", "total", "ending_balance"], ...rows]), "text/csv;charset=utf-8");
  };
  return <>
    <p className="form-hint">{account.name} · Current account balance: {money(accountBalance(account, state), account.currency)}. This contracted schedule assumes monthly payments and the rates you record. Payment replay is separately reviewed below; when enabled, actual recorded payments reduce principal after interest and insurance. Saving changed rates or principal-only choices recalculates that history. No payment or interest expense is created.</p>
    <form ref={ref} onChange={invalidate} onSubmit={submit(form => ({ action: "loanTerms", accountId: account.id, terms: build(form), expectedRevision: state.profile!.revision }))}>
      <label>Loan type<select name="subtype" defaultValue={terms?.subtype ?? ""}><option value="">Not specified</option>{Object.entries({ mortgage: "Mortgage", student: "Student loan", auto: "Auto loan", home_equity: "Home equity", line_of_credit: "Line of credit", business: "Business", other: "Other loan" }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className="form-grid"><label>Original principal ({account.currency})<input name="principal" inputMode="decimal" defaultValue={terms?.initialBalance == null ? "" : moneyInput(terms.initialBalance, account.currency)} placeholder="Amount originally borrowed" /></label><label>Origination date<input name="startDate" type="date" min="1900-01-01" max={today()} defaultValue={terms?.startDate ?? ""} /></label></div>
      <div className="form-grid"><label>Term in months<input name="term" type="number" min="1" max="1200" step="1" defaultValue={terms?.termMonths ?? ""} /></label><label>Base annual interest (%)<input name="rate" inputMode="decimal" placeholder="e.g. 4.125" defaultValue={terms?.annualRate ?? ""} /></label></div>
      <div className="form-grid"><label>Rate type<select value={rateType} onChange={e => setRateType(e.target.value)}><option value="">Not specified</option><option value="fixed">Fixed</option><option value="variable">Variable</option><option value="adjustable">Adjustable</option>{rateType && !["fixed", "variable", "adjustable"].includes(rateType) && <option value={rateType}>{rateType} · variable</option>}</select></label><label>Interest day count<select name="dayCount" defaultValue={terms?.dayCount ?? "thirty_360"}><option value="thirty_360">30/360 · monthly twelfth</option><option value="actual_365">Actual/365</option><option value="actual_actual">Actual/actual</option></select></label></div>
      <p className="form-hint">30/360 charges a twelfth of the annual rate each monthly period. Actual day counts use calendar days; payment sizing stays monthly, with the final payment settling the balance. Recorded changes resize variable-rate payments on the first payment date on or after the change. Each period accrues at its opening rate.</p>
      <fieldset className="loan-rate-changes"><legend>Recorded rate changes</legend>{rateType === "fixed" && <p className="form-hint">Fixed-rate schedules ignore these rows. They are retained if you switch back to variable.</p>}{changes.map((row, index) => <div className="loan-rate-row" key={index}><label>Effective date<input type="date" min="1900-01-01" max="2199-12-31" required value={row.date} onChange={e => setChanges(changes.map((r, i) => i === index ? { ...r, date: e.target.value } : r))} /></label><label>Annual rate (%)<input inputMode="decimal" required value={row.rate} onChange={e => setChanges(changes.map((r, i) => i === index ? { ...r, rate: e.target.value } : r))} /></label><button type="button" className="icon-button negative" aria-label={`Remove rate change ${index + 1}`} onClick={() => { setChanges(changes.filter((_, i) => i !== index)); invalidate(); }}><Trash2 size={16} /></button></div>)}<button type="button" className="button" disabled={changes.length >= 200} onClick={() => { setChanges([...changes, { date: "", rate: "" }]); invalidate(); }}><Plus size={15} />Add rate change</button></fieldset>
      <div className="form-grid"><label>Down payment ({account.currency})<input name="deposit" inputMode="decimal" defaultValue={terms?.downPayment == null ? "" : moneyInput(terms.downPayment, account.currency)} /></label><label>Annual insurance (%)<input name="insuranceRate" inputMode="decimal" defaultValue={terms?.insuranceRate ?? ""} /></label></div>
      <label>Insurance basis<select name="insuranceType" defaultValue={terms?.insuranceType ?? ""}><option value="">Not specified · decreasing balance</option><option value="decreasing_life">Decreasing · period opening balance</option><option value="level_term">Level · original principal</option></select></label>
      <p className="form-hint">Insurance is an additional monthly premium, outside principal and interest. The down payment is recorded separately from borrowed principal.</p>
      <label><input type="checkbox" name="principalOnlyTransfers" defaultChecked={!!terms?.principalOnlyTransfers}/>Linked transfers contain principal only</label><p className="form-hint">When replay is enabled, this choice applies linked payments wholly to principal and assumes that period’s interest was recorded separately. It never creates the separate interest expense. Unlinked payments still cover interest and insurance first. Disable replay before removing terms or changing the original opening anchors.</p>
      <div className="form-actions">{terms && <button type="button" className="button danger" disabled={disabled || !!account.archived || account.loanReplay===1} onClick={onRemove}>Remove saved terms</button>}<button type="button" className="button" onClick={check}>Preview schedule</button><button className="button primary" disabled={disabled || !!account.archived}>Save loan terms</button></div>
    </form>
    {issue && <p className="form-error" role="alert">{issue}</p>}
    {preview && <section className="loan-schedule" aria-label="Contracted schedule preview"><h3>Contracted schedule · preview</h3><p className="form-hint">{preview.payments.length} payments · Last payment {preview.payoffDate}{preview.reAmortizing ? " · Payments resize with recorded rates" : ""}. This preview includes the terms currently shown in the form; save them to retain edits.</p><dl className="loan-totals"><div><dt>First payment, including insurance</dt><dd>{money(preview.payments[0].total, account.currency)}</dd></div><div><dt>Total interest</dt><dd>{money(preview.totalInterest, account.currency)}</dd></div><div><dt>Total insurance</dt><dd>{money(preview.totalInsurance, account.currency)}</dd></div><div><dt>Total paid</dt><dd>{money(preview.totalPaid, account.currency)}</dd></div></dl><button className="text-button" onClick={exportSchedule}><Download size={14} />Download complete schedule CSV</button><div className="table-wrap"><table><caption className="sr-only">Monthly principal, interest, insurance and balance in {account.currency}</caption><thead><tr><th>Date</th><th>Interest rate</th><th>Payment rate</th><th>Principal</th><th>Interest</th><th>Insurance</th><th>Total</th><th>Balance</th></tr></thead><tbody>{preview.payments.slice(page * 24, page * 24 + 24).map(row => <tr key={row.number}><th scope="row">{row.date}</th><td>{row.accrualRate}%</td><td>{row.sizingRate}%</td><td>{money(row.principal, account.currency)}</td><td>{money(row.interest, account.currency)}</td><td>{money(row.insurance, account.currency)}</td><td>{money(row.total, account.currency)}</td><td>{money(row.endingBalance, account.currency)}</td></tr>)}</tbody></table></div><div className="table-footer"><span>{page * 24 + 1}–{Math.min(preview.payments.length, (page + 1) * 24)} of {preview.payments.length}</span><div><button className="icon-button" aria-label="Previous schedule page" disabled={!page} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="Next schedule page" disabled={(page + 1) * 24 >= preview.payments.length} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></div></div></section>}
    {termsDirty&&<p className="form-hint">Save the edited terms before reviewing payment accounting. History below uses the saved contract.</p>}
    <LoanReplayView state={state} accountId={account.id} demo={demo} disabled={disabled||termsDirty} onBusy={onBusy} onChanged={onChanged}/>
    <LoanProjectionView state={state} accountId={account.id} demo={demo} termsDirty={termsDirty}/>
  </>;
}
