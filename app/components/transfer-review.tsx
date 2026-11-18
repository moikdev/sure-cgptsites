"use client";
import {money} from '../../lib/finance';
import type {TransferMatchReview} from '../../lib/transfer-match';
import {kindLabel} from './forms';
type Review=Pick<TransferMatchReview,'accounts'|'closedStatements'|'feesKept'|'rate'|'reviewedOn'>&{operation:'link'|'unlink'|'create';legs:(TransferMatchReview['legs'][number]&{created?:boolean})[]};
export function TransferReview({review}:{review:Review}){return <>
  <h4>{review.operation==='create'?'Create one missing entry and link it':review.operation==='link'?'Link these existing entries':'Unlink and keep these entries'}</h4>
  {review.legs.map(t=><p key={t.id}><strong>{t.created?'New entry: ':''}{t.name}</strong> · {money(t.amount,t.currency)}<br/>{t.accountName} · {t.date}<br/>{t.created?'New entry':kindLabel[t.beforeKind]} → {kindLabel[t.afterKind]}</p>)}
  <p className="form-hint">Applied conversion: 1 {review.legs[0].currency} = {review.rate} {review.legs[1].currency}. {review.operation==='unlink'?'The transfer’s conversion link is removed; each native amount remains recorded.':'The rate follows the two native amounts and stays fixed when library quotes change.'}</p>
  <h4>Account balances through {review.reviewedOn}</h4>{review.accounts.map(a=><p key={a.accountId}>{a.name}: {money(a.before,a.currency)} → {money(a.after,a.currency)}{a.loanPrincipalOnly&&<><br/><small>Principal-only loan replay: linked payments assume interest is paid separately. Record any actual interest expense yourself.</small></>}</p>)}
  {review.closedStatements.length>0&&<p>{review.closedStatements.length} completed statement(s) will be flagged for review.</p>}
  {review.operation==='unlink'&&<p>Both entries become standard transactions. {review.feesKept} linked fee expense(s) stay in the ledger as standalone expenses, with their receipts.</p>}
</>;}
