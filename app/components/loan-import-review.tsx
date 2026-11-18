"use client";
import { useMemo, useState } from "react";
import { money, type Currency } from "../../lib/finance";
import { loanSchedule } from "../../lib/loans";
import type { LoanTerms } from "../../lib/loan-types";

export type LoanImportRow = { name: string; currency: Currency; terms: LoanTerms; replay?:number|null };
export function LoanImportReview({ rows }: { rows: LoanImportRow[] }) {
  const [page, setPage] = useState(0);
  const visible = useMemo(() => rows.slice(page * 10, page * 10 + 10).map(row => ({row,schedule:loanSchedule(row.terms)})), [rows,page]);
  if (!rows.length) return null;
  return <section className="budget-callout"><h3>Loan contract review</h3><p>Review original contract terms separately from the current balances below. Contracted schedules do not create ledger entries. A recovered enabled replay preference changes derived principal balances only when the original principal/date anchors match. Native Sure imports require a separate review before enabling replay. All loan terms and recorded rate changes are included in the downloadable review.</p>
    {visible.map(({row,schedule}, index) => {
      const t = row.terms;
      return <article className="file-card" key={page * 10 + index}><strong>{row.name} · {row.currency}</strong>
        <p>{t.subtype ?? "Loan type not specified"} · Original principal: {t.initialBalance === null ? "not recorded" : money(t.initialBalance, row.currency)} · Origination: {t.startDate ?? "not recorded"} · Term: {t.termMonths ?? "not recorded"} months.</p>
        <p>Annual rate: {t.annualRate === null ? "not recorded" : `${t.annualRate}%`} · {t.rateType ?? "Rate type not recorded"} · {({ thirty_360: "30/360", actual_365: "Actual/365", actual_actual: "Actual/actual" })[t.dayCount]}.</p>
        <p>Down payment: {t.downPayment === null ? "not recorded" : money(t.downPayment, row.currency)} · Annual insurance: {t.insuranceRate === null ? "not recorded" : `${t.insuranceRate}%`} · {t.insuranceType === "level_term" ? "Original principal" : "Decreasing balance"} insurance basis.</p>
        {t.rateChanges.length > 0 && <details><summary>{t.rateChanges.length} recorded rate changes{t.rateType === "fixed" ? " · ignored while fixed" : ""}</summary><ul>{[...t.rateChanges].sort((a, b) => a.date.localeCompare(b.date)).map(change => <li key={change.date}>{change.date} · {change.rate}%</li>)}</ul></details>}
        <p>{schedule ? `First payment including insurance: ${money(schedule.payments[0].total, row.currency)} · Contracted total: ${money(schedule.totalPaid, row.currency)} · Last payment: ${schedule.payoffDate}.` : "Partial terms retained; the contract is incomplete for a schedule."}</p>
        <p>Payment replay: {row.replay===1?"enabled in this backup":row.replay===0?"disabled":"not yet reviewed"}. Review the opening principal/date before relying on replayed balances.</p>
        {t.principalOnlyTransfers && <p>Linked transfers are configured as principal-only; loan replay assumes the period’s interest was recorded separately and does not create that expense.</p>}
      </article>;
    })}
    {rows.length > 10 && <div className="table-footer"><button className="button small" disabled={!page} onClick={() => setPage(page - 1)}>Previous loans</button><span>{page * 10 + 1}–{Math.min(rows.length, page * 10 + 10)} of {rows.length}</span><button className="button small" disabled={(page + 1) * 10 >= rows.length} onClick={() => setPage(page + 1)}>Next loans</button></div>}
  </section>;
}
