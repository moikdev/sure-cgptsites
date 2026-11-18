import {ApiError,readState} from './repository';
import {createRuleReview,ruleReviewCSVRows,csvRowStream} from './rule-review';
import {ruleRunReceipt,type RuleRunOptions} from './rule-receipt';
export interface RuleReviewInput extends RuleRunOptions {mode:'review'|'export';offset:number;receipt?:string;expectedRevision?:number;}
export async function reviewRuleRun(owner:string,c:RuleReviewInput){
 const state=await readState(owner);if(!state.profile)throw new ApiError(409,'Create your workspace first.');
 const revision=state.profile.revision;
 if(c.ruleId&&!state.rules.some(r=>r.id===c.ruleId))throw new ApiError(404,'Rule not found.');
 if(c.scope.accountId&&!state.accounts.some(a=>a.id===c.scope.accountId))throw new ApiError(404,'Account not found.');
 const ids=new Set(state.transactions.map(t=>t.id));if(c.scope.transactionIds?.some(id=>!ids.has(id)))throw new ApiError(404,'Transaction not found.');
 if(c.scope.from&&c.scope.to&&c.scope.from>c.scope.to)throw new ApiError(400,'The date range ends before it starts.');
 const options:RuleRunOptions={...(c.ruleId?{ruleId:c.ruleId}:{}),scope:c.scope,ignoreLocks:c.ignoreLocks},receipt=await ruleRunReceipt(owner,revision,options);
 if(c.expectedRevision!==undefined&&(c.expectedRevision!==revision||c.receipt!==receipt))throw new ApiError(409,'The rules, options or workspace changed. Review the run again.');
 let report;try{report=createRuleReview(state,options,c.offset,receipt);}catch(e){throw new ApiError(400,(e as Error).message);}
 if(c.mode==='review')return {...report,receipt,expectedRevision:revision};
 return new Response(csvRowStream(ruleReviewCSVRows(state,options,receipt)),{headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="sure-rule-review.csv"'}});
}
