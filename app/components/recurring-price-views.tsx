"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { CURRENCIES, money, moneyInput, parseMoney, today, type Currency, type FinanceState, type RecurringEntry } from "../../lib/finance";
import { materialPriceChange, type DetectedRecurringPrice } from "../../lib/recurring-prices";

type PriceReview = { total: number; offset: number; limit: number; rows: DetectedRecurringPrice[]; asOf: string; expectedRevision: number; receipt: string; canCommit: boolean };
export function RecurringPriceHistory({ state, recurringEntryId, demo, busy, onBusy, onChanged, onEdit }: {
  state: FinanceState; recurringEntryId?: string; demo: boolean; busy: boolean;
  onBusy: (value: boolean) => void; onChanged: () => Promise<void>; onEdit: (entry: RecurringEntry) => void;
}) {
  const [seriesId, setSeriesId] = useState(recurringEntryId ?? ""), [page, setPage] = useState(0), [preview, setPreview] = useState<PriceReview | null>(null);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [removeId, setRemoveId] = useState<string | null>(null), [needsReload, setNeedsReload] = useState(false);
  useEffect(() => { setPreview(null); setRemoveId(null); setPage(0); }, [state.profile?.revision, seriesId]);
  useEffect(() => { setSeriesId(recurringEntryId ?? ""); }, [recurringEntryId]);
  const disabled = busy || demo || needsReload;
  const history = state.recurringPriceChanges.filter(p => !seriesId || p.recurringEntryId === seriesId).sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn) || a.id.localeCompare(b.id));
  const entry = state.recurringEntries.find(e => e.id === seriesId);
  const action = async (command: Record<string, unknown>, previewOnly = false) => {
    if (disabled) return;
    onBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/finance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(command) });
      const data = await response.json() as PriceReview & { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error ?? "Price history could not be saved.");
      if (previewOnly) setPreview(data);
      else {
        setPreview(null); setRemoveId(null); setNotice(data.message ?? "Price history saved.");
        try { await onChanged(); } catch { setNeedsReload(true); setError("History was saved, but the latest data could not be loaded. Reload before continuing."); }
      }
    } catch (error) { setPreview(null); setError(error instanceof Error ? error.message : "The price review could not be completed."); }
    finally { onBusy(false); }
  };
  const review = (offset = 0) => void action({ action: "recurringPriceReview", mode: "preview", recurringEntryId: seriesId || undefined, asOf: preview?.asOf ?? today(), offset }, true);
  return <div className="recurring-price-history"><p className="form-hint">Keep known price changes and review repeated payment amounts. Two consecutive paid occurrences must each have exactly one confirmed payment at nearly the same new price. Recording history does not change a schedule’s stated price or any payment.</p>
    <label>Schedule<select disabled={busy} value={seriesId} onChange={e => { setSeriesId(e.target.value); setPreview(null); setNotice(""); }}><option value="">All schedules</option>{state.recurringEntries.map(e => <option key={e.id} value={e.id}>{e.name} · {e.currency}</option>)}</select></label>
    <div className="form-actions"><button className="button" disabled={disabled} onClick={() => review()}>Review repeated prices</button>{entry && <button className="button" disabled={busy || needsReload} onClick={() => onEdit(entry)}>Edit schedule</button>}</div>
    {demo && <p className="form-hint">Sample workspace · recording and server reviews are disabled.</p>}
    {preview && <section className="budget-callout"><h3>Observed price review</h3><p>{preview.total} possible change(s) from payments recorded through {preview.asOf}. The stated schedule amount is the comparison, not a claim that the biller announced a new price.</p>{preview.rows.map(row => <article className="file-card" key={row.recurringEntryId}><strong>{row.seriesName} · {row.effectiveOn}</strong><p>Stated {money(row.previousAmount, row.currency)} → observed {money(row.newAmount, row.currency)} · {row.currency}{row.material ? " · At least a 10% change" : ""}</p><ul>{row.observations.map(o => <li key={o.occurrenceId}>Due {o.dueOn} · {money(o.amount, row.currency)} · Paid {o.paidOn ?? "date not recorded"}{o.transactionId ? " · Linked transaction" : " · Manual payment record"}</li>)}</ul></article>)}
      {preview.total > 50 && <div className="table-footer"><button className="button small" disabled={busy || !preview.offset} onClick={() => review(Math.max(0, preview.offset - preview.limit))}>Previous review page</button><span>{preview.offset + 1}–{Math.min(preview.total, preview.offset + preview.rows.length)} of {preview.total}</span><button className="button small" disabled={busy || preview.offset + preview.rows.length >= preview.total} onClick={() => review(preview.offset + preview.limit)}>Next review page</button></div>}
      {!preview.canCommit && <p className="form-error">The workspace’s 5,000-record price-history limit would be exceeded. Export a backup and remove unneeded history first.</p>}
      <button className="button primary" disabled={disabled || !preview.canCommit || !preview.total} onClick={() => void action({ action: "recurringPriceReview", mode: "commit", recurringEntryId: seriesId || undefined, asOf: preview.asOf, expectedRevision: preview.expectedRevision, receipt: preview.receipt })}>Record all {preview.total} observed change(s)</button>
    </section>}
    {notice && <p role="status" className="form-hint">{notice}</p>}{error && <p role="alert" className="form-error">{error}</p>}{needsReload && <button className="button" onClick={() => location.reload()}>Reload workspace</button>}
    <section className="loan-schedule"><h3>Recorded price history</h3>{history.slice(page * 20, page * 20 + 20).map(row => <article className="file-card" key={row.id}><strong>{state.recurringEntries.find(e => e.id === row.recurringEntryId)?.name} · {row.effectiveOn}</strong><p>{money(row.previousAmount, row.currency)} → {money(row.newAmount, row.currency)} · {row.currency} · {row.source === "detected" ? "Repeated payment observation" : "User-recorded"}{materialPriceChange(row.previousAmount, row.newAmount) ? " · At least 10%" : ""}</p><p>{row.transactionId ? `Linked charge: ${state.transactions.find(t => t.id === row.transactionId)?.name ?? "Transaction"}` : "No linked transaction. The original price values remain recorded."}</p>{removeId === row.id ? <div className="budget-callout"><p>Remove this history record? Payments and schedule amounts stay in place. A later price review may detect it again.</p><button className="button" disabled={busy} onClick={() => setRemoveId(null)}>Cancel</button><button className="button danger" disabled={disabled} onClick={() => void action({ action: "deleteRecurringPrice", id: row.id, expectedRevision: state.profile!.revision })}>Remove history record</button></div> : <button className="icon-button negative" aria-label={`Remove price history for ${row.effectiveOn}`} disabled={disabled} onClick={() => setRemoveId(row.id)}><Trash2 size={15} /></button>}</article>)}{!history.length && <p className="helper-text">No price history recorded for this selection.</p>}
      {history.length > 20 && <div className="table-footer"><span>{page * 20 + 1}–{Math.min(history.length, page * 20 + 20)} of {history.length}</span><div><button className="icon-button" aria-label="Previous price history page" disabled={busy || !page} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="Next price history page" disabled={busy || (page + 1) * 20 >= history.length} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></div></div>}
    </section>
    {entry ? <ManualPrice key={entry.id} entry={entry} disabled={disabled} revision={state.profile!.revision} save={command => void action(command)} onError={setError} /> : <p className="form-hint">Choose a schedule to record a known price change manually.</p>}
  </div>;
}

function ManualPrice({ entry, disabled, revision, save, onError }: { entry: RecurringEntry; disabled: boolean; revision: number; save: (command: Record<string, unknown>) => void; onError: (value: string) => void }) {
  const [currency, setCurrency] = useState<Currency>(entry.currency);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const form = new FormData(event.currentTarget);
      save({ action: "recurringPriceRecord", recurringEntryId: entry.id, effectiveOn: form.get("effectiveOn"), previousAmount: parseMoney(String(form.get("previousAmount")), currency), newAmount: parseMoney(String(form.get("newAmount")), currency), currency, expectedRevision: revision });
    } catch (error) { onError(error instanceof Error ? error.message : "Check the price amounts."); }
  };
  return <details className="loan-schedule"><summary>Record a known price change</summary><form onSubmit={submit}><p className="form-hint">Record the old/new amounts and their own currency. This adds history only. Edit the schedule separately to change its expected amount.</p><label>Effective date<input name="effectiveOn" type="date" min="1900-01-01" max="2199-12-31" defaultValue={today()} required disabled={disabled} /></label><label>Price currency<select value={currency} disabled={disabled} onChange={e => setCurrency(e.target.value as Currency)}>{CURRENCIES.map(c => <option key={c}>{c}</option>)}</select></label><div className="form-grid"><label>Previous price<input key={`old-${currency}`} name="previousAmount" inputMode="decimal" defaultValue={currency === entry.currency ? moneyInput(Math.abs(entry.amount), currency) : ""} required disabled={disabled} /></label><label>New price<input key={`new-${currency}`} name="newAmount" inputMode="decimal" required disabled={disabled} /></label></div><button className="button" disabled={disabled}>Record price history</button></form></details>;
}
