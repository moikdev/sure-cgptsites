import {iterateRuleEvaluation,ruleValidationWorkspace,type RuleEvaluationEvent} from './rules.ts';
import {validateWorkspace} from './workspace.ts';
import {csvCell} from './csv.ts';
import {moneyInput,type FinanceState,type Currency} from './finance.ts';
import type {RuleRunOptions} from './rule-receipt.ts';
export {csvRowStream} from './monthly-breakdown.ts';
export const RULE_REVIEW_LIMIT=50,MAX_RULE_REVIEW_CSV_BYTES=100*1024*1024;
export type RuleReviewChange=Omit<RuleEvaluationEvent['change'],'changes'>&{index:number;ruleId:string;ruleName:string;proposedSplit:boolean;changes:{field:string;before:unknown;after:unknown;beforeText:string;afterText:string}[]};
function descriptors(state:FinanceState){
 const categories=new Map(state.categories.map(c=>[c.id,c.name])),merchants=new Map(state.merchants.map(m=>[m.id,m.name])),tags=new Map(state.tags.map(t=>[t.id,t.name])),originalSplits=new Set(state.splitLines.map(l=>l.id));
 const value=(field:string,v:unknown,currency:Currency):string=>{
  if(field==='categoryId')return v?categories.get(String(v))??'Unavailable category':'Uncategorized';if(field==='merchantId')return v?merchants.get(String(v))??'Unavailable merchant':'No merchant';
  if(field==='tagIds')return JSON.stringify((v as string[]??[]).map(id=>tags.get(id)??'Unavailable tag'));
  if(field==='excluded')return v?'Excluded':'Included';
  if(field==='split')return v===null?'Unsplit':(v as {name:string;amount:number;categoryId:string|null;merchantId:string|null;tagIds:string[]}[]).map(l=>`${l.name}: ${moneyInput(l.amount,currency)} ${currency} · ${l.categoryId?categories.get(l.categoryId)??'Unavailable category':'Uncategorized'} · ${l.merchantId?merchants.get(l.merchantId)??'Unavailable merchant':'No merchant'} · ${l.tagIds.map(id=>tags.get(id)??'Unavailable tag').join(', ')||'No tags'}`).join('\n');
  return String(v??'');
 };
 return (event:RuleEvaluationEvent):RuleReviewChange=>({...event.change,index:event.index,ruleId:event.ruleId,ruleName:event.ruleName,proposedSplit:!!event.change.splitLineId&&!originalSplits.has(event.change.splitLineId),changes:event.change.changes.map(c=>({...c,beforeText:value(c.field,c.before,event.change.currency),afterText:value(c.field,c.after,event.change.currency)}))});
}
function* headerRows(state:FinanceState,options:RuleRunOptions,receipt:string):Generator<(string|number)[]>{
 yield ['Report','Complete proposed rule changes'];yield ['Workspace revision',state.profile!.revision];yield ['Review receipt',receipt];yield ['Scope',JSON.stringify(options)];
 yield ['Meaning','Proposed changes only. Rule order, field protections and scope apply. Amount is the recorded native amount; rules do not change recorded money. Split amounts inside JSON are integer minor units. Proposed split IDs are review-only, not future saved IDs.'];
 yield ['Change number','Rule ID','Rule','Transaction ID','Split ID','Proposed split','Date','Description before this rule','Currency','Recorded amount','Field','Before','After','Before raw JSON','After raw JSON'];
}
function* eventRows(change:RuleReviewChange):Generator<(string|number)[]>{
 for(const c of change.changes)yield [change.index,change.ruleId,change.ruleName,change.transactionId,change.splitLineId??'',change.proposedSplit?'yes':'no',change.date,change.name,change.currency,moneyInput(change.amount,change.currency),c.field,c.beforeText,c.afterText,JSON.stringify(c.before??null),JSON.stringify(c.after??null)];
}
export function createRuleReview(state:FinanceState,options:RuleRunOptions,offset=0,receipt=''){
 if(!Number.isSafeInteger(offset)||offset<0||offset>1999950||offset%RULE_REVIEW_LIMIT)throw new Error('Choose a supported rule-review page.');
 const describe=descriptors(state),changes:RuleReviewChange[]=[],iterator=iterateRuleEvaluation(state,{...options,reviewIdentities:true}),encoder=new TextEncoder();let csvBytes=3,fieldChanges=0;
 const measure=(row:(string|number)[])=>{csvBytes+=encoder.encode(row.map(csvCell).join(',')+'\r\n').byteLength;if(csvBytes>MAX_RULE_REVIEW_CSV_BYTES)throw new Error('This complete rule review exceeds 100 MiB. Narrow its account/date scope.');};
 try{
  for(const row of headerRows(state,options,receipt))measure(row);
  let step=iterator.next();while(!step.done){const change=describe(step.value);fieldChanges+=change.changes.length;for(const row of eventRows(change))measure(row);if(change.index>offset&&change.index<=offset+RULE_REVIEW_LIMIT)changes.push(change);step=iterator.next();}
  const result=step.value;validateWorkspace(ruleValidationWorkspace({...result,changes:[]},'manual'));
  if(offset&&offset>=result.totalChanges)throw new Error('This rule-review page is beyond the last change.');
  return {method:'sure_complete_rule_review' as const,summary:result.summary,matched:result.matched,modified:result.modified,skipped:result.skipped,changedTransactions:result.changedTransactions,totalChanges:result.totalChanges,fieldChanges,csvBytes,changes,page:{offset,limit:RULE_REVIEW_LIMIT,total:result.totalChanges}};
 }finally{iterator.return(undefined as never);}
}
export type RuleReview=ReturnType<typeof createRuleReview>&{receipt:string;expectedRevision:number};
export function* ruleReviewCSVRows(state:FinanceState,options:RuleRunOptions,receipt:string):Generator<(string|number)[]>{
 yield* headerRows(state,options,receipt);const iterator=iterateRuleEvaluation(state,{...options,reviewIdentities:true}),describe=descriptors(state);
 try{let step=iterator.next();while(!step.done){yield* eventRows(describe(step.value));step=iterator.next();}}finally{iterator.return(undefined as never);}
}
