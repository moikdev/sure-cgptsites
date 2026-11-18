import { reportingTransactions, type Currency, type FinanceState, type Transaction } from "./finance.ts";
export interface LedgerFilters { currency: Currency; month: string; search?: string; accountId?: string; categoryId?: string; tagId?: string; merchantId?: string; kind?: string;reconciledStatus?:string; }
export function filteredReportEntries(state: FinanceState, filters: LedgerFilters): Transaction[] {
  const accounts = new Map(state.accounts.map(a => [a.id,a])), merchants = new Map(state.merchants.map(m => [m.id,m.name])), tags = new Map(state.tags.map(t => [t.id,t.name])), roots = new Map(state.transactions.map(t => [t.id,t]));
  const pendingIds=new Set(state.transferDetails.filter(d=>d.status==='pending').map(d=>d.id));
  return reportingTransactions(state).filter(t => {
    if (accounts.get(t.accountId)?.currency !== filters.currency || !t.date.startsWith(filters.month) || (filters.accountId && t.accountId !== filters.accountId)) return false;
    if(filters.reconciledStatus&&(t.reconciledStatus??'unreconciled')!==filters.reconciledStatus)return false;
    if (filters.categoryId && (filters.categoryId === "uncategorized" ? !!t.categoryId : t.categoryId !== filters.categoryId)) return false;
    if (filters.tagId && (filters.tagId === "untagged" ? !!t.tagIds?.length : !t.tagIds?.includes(filters.tagId))) return false;
    if (filters.merchantId && (filters.merchantId === "no-merchant" ? !!t.merchantId : t.merchantId !== filters.merchantId)) return false;
    const confirmed=!!t.transferId&&!pendingIds.has(t.transferId);if (filters.kind && (filters.kind === "transfer" ? !confirmed : confirmed)) return false;
    const root = roots.get(t.splitParentId ?? t.id);
    return !filters.search || [t.name,t.notes,root?.name,root?.notes,merchants.get(t.merchantId ?? ""),...(t.tagIds ?? []).map(id => tags.get(id))].join(" ").toLowerCase().includes(filters.search.toLowerCase());
  });
}
export function filteredRootEntries(state: FinanceState, filters: LedgerFilters) {
  const ids = new Set(filteredReportEntries(state,filters).map(t => t.splitParentId ?? t.id));
  return state.transactions.filter(t => ids.has(t.id));
}

export function exportableReportEntries(state:FinanceState,filters:LedgerFilters){const pendingIds=new Set(state.transferDetails.filter(d=>d.status==='pending').map(d=>d.id));return filteredReportEntries(state,filters).filter(t=>(!t.transferId||pendingIds.has(t.transferId))&&!['funds_movement','cc_payment'].includes(t.kind));}
