"use client";
import {useEffect,useRef,useState} from 'react';
import {money,type FinanceState} from '../../lib/finance';
import type {RuleReview} from '../../lib/rule-review';
const fieldLabels:Record<string,string>={name:'Description',categoryId:'Category',merchantId:'Merchant',tagIds:'Tags',excluded:'Report inclusion',split:'Split creation'};
export function RulePreview({state,ruleId,disabled,onComplete}:{state:FinanceState;ruleId?:string;disabled:boolean;onComplete:(message:string)=>Promise<void>}){
 const [account,setAccount]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[ignoreLocks,setIgnore]=useState(false),[review,setReview]=useState<RuleReview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),generation=useRef(0),abort=useRef<AbortController|null>(null);
 const invalidate=()=>{generation.current++;abort.current?.abort();setReview(null);setError('');setBusy(false);};
 useEffect(()=>{invalidate();return()=>{generation.current++;abort.current?.abort();};},[state.profile?.ownerId,state.profile?.revision,ruleId]);
 useEffect(()=>{setAccount('');setFrom('');setTo('');setIgnore(false);},[state.profile?.ownerId,ruleId]);
 async function execute(mode:'review'|'export'|'commit',offset=0,fresh=false){
  if((mode!=='review'||offset>0)&&!review)return;
  abort.current?.abort();const controller=new AbortController(),token=++generation.current;abort.current=controller;setBusy(true);setError('');
  const options={...(ruleId?{ruleId}:{}),scope:{...(account?{accountId:account}:{}),...(from?{from}:{}),...(to?{to}:{})},ignoreLocks},guard=review?{expectedRevision:review.expectedRevision,receipt:review.receipt}:{};
  try{
   const response=await fetch(mode==='commit'?'/api/finance':'/api/rule-review',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(mode==='commit'?{action:'ruleRun',mode:'commit',...options,...guard}:{mode,...options,offset,...((mode==='review'&&!fresh&&review)||mode==='export'?guard:{})}),signal:controller.signal,cache:'no-store'});
   if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error??'The rule review failed.');}
   if(mode==='export'){
    const blob=await response.blob();if(token!==generation.current)return;const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='sure-rule-review.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }else if(mode==='review'){const next=await response.json() as RuleReview;if(token!==generation.current)return;setReview(next);}
   else{const data=await response.json() as {message:string};if(token!==generation.current)return;await onComplete(data.message);}
  }catch(e){if(token!==generation.current||controller.signal.aborted)return;setError((e as Error).message);setReview(null);}
  finally{if(token===generation.current)setBusy(false);}
 }
 const unavailable=busy||disabled;
 const change=(fn:()=>void)=>{invalidate();fn();};
 return <><p className="form-hint">{ruleId?'Review “'+(state.rules.find(r=>r.id===ruleId)?.name??'Selected rule')+'” with enabled rules above it. Rules below it do not run.':'Review enabled rules in order.'} This does not write until you select Apply preview. Recorded amounts and account balances do not change.</p>
 <label>Account<select disabled={unavailable} value={account} onChange={e=>change(()=>setAccount(e.target.value))}><option value="">All my accounts</option>{state.accounts.map(a=><option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></label>
 <div className="form-grid"><label>From<input type="date" min="1900-01-01" max="2199-12-31" disabled={unavailable} value={from} onChange={e=>change(()=>setFrom(e.target.value))}/></label><label>Through<input type="date" min={from||'1900-01-01'} max="2199-12-31" disabled={unavailable} value={to} onChange={e=>change(()=>setTo(e.target.value))}/></label></div>
 <label className="checkbox-label"><input type="checkbox" checked={ignoreLocks} disabled={unavailable} onChange={e=>change(()=>setIgnore(e.target.checked))}/>Override protected fields {ruleId?'for this requested rule':'for enabled rules'}</label>
 <button className="button" disabled={unavailable} onClick={()=>void execute('review',0,true)}>Preview changes</button>{busy&&<p role="status">Loading complete rule review…</p>}{error&&<p role="alert" className="form-error">{error}</p>}
 {review&&<><div className="budget-callout">{review.changedTransactions} transactions would change · {review.totalChanges} rule changes · {review.fieldChanges} changed fields · {review.skipped} matches with protected or ineligible actions</div>
 <details><summary>Rule-by-rule totals</summary>{review.summary.map((r,i)=><p className="helper-text" key={i}>{r.name}: {r.matched} matched, {r.modified} changed, {r.skipped} protected/skipped</p>)}</details>
 <p className="form-hint">Every proposed change is available below, 50 per page. The complete CSV includes all changes, original references and the selected scope. Proposed split references describe the preview; saved split IDs are assigned when you apply it.</p>
 <div className="goal-actions"><button className="button small" disabled={unavailable||review.page.offset===0} onClick={()=>void execute('review',0)}>First changes</button><button className="button small" disabled={unavailable||review.page.offset===0} onClick={()=>void execute('review',review.page.offset-review.page.limit)}>Previous changes</button><span role="status">{review.totalChanges?(review.page.offset+1)+'–'+Math.min(review.totalChanges,review.page.offset+review.page.limit)+' of '+review.totalChanges:'No changes'}</span><button className="button small" disabled={unavailable||review.page.offset+review.page.limit>=review.totalChanges} onClick={()=>void execute('review',review.page.offset+review.page.limit)}>Next changes</button><button className="button small" disabled={unavailable||review.page.offset+review.page.limit>=review.totalChanges} onClick={()=>void execute('review',Math.floor((review.totalChanges-1)/review.page.limit)*review.page.limit)}>Last changes</button><button className="button small" disabled={unavailable} onClick={()=>void execute('export')}>Complete rule review CSV</button></div>
 <div className="rule-preview-changes">{review.changes.map(r=><section key={r.index}><strong>#{r.index} · {r.ruleName}</strong><p>{r.date} · {r.name} · {money(r.amount,r.currency)}{r.proposedSplit?' · Proposed split':r.splitLineId?' · Split line':''}</p>{r.changes.map((c,j)=><p key={j}>{fieldLabels[c.field]??c.field}: <del style={{whiteSpace:'pre-wrap'}}>{c.beforeText}</del> → <span style={{whiteSpace:'pre-wrap'}}>{c.afterText}</span></p>)}</section>)}</div>
 <div className="form-actions"><button className="button primary" disabled={unavailable} onClick={()=>void execute('commit')}>Apply preview</button></div></>}
 </>;
}
