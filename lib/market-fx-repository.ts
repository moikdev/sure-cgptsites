import {marketPricingCommand} from './market-fx-schema';
import {ApiError,commitMutation,database,readState} from './repository';
import {changedMarketAccounts,reviewMarketPrices} from './market-fx';
import {investmentAccountBalance} from './portfolio';
import {validateWorkspace} from './workspace';
import {today,type FinanceState} from './finance';
export function marketStatementReviews(owner:string,before:FinanceState,after:FinanceState){return [...changedMarketAccounts(before,after)].map(([accountId,date])=>database().prepare('UPDATE account_statements SET review_required=1 WHERE owner_id=? AND account_id=? AND completed_at IS NOT NULL AND period_end>=?').bind(owner,accountId,date));}
export async function executeMarketPricing(owner:string,input:unknown,revision:number){
 const parsed=marketPricingCommand.safeParse(input);if(!parsed.success)return null;const c=parsed.data,state=await readState(owner);if(!state.profile||state.profile.revision!==revision)throw new ApiError(409,'Your workspace changed. Preview foreign price valuation again.');
 const asOf=c.asOf??today(),next={...state,profile:{...state.profile,marketFx:c.enabled?1:0}},review=reviewMarketPrices(next),errors:string[]=[];
 if(c.enabled&&review.issueCount)errors.push(`${review.issueCount} used foreign price point(s) need a valid conversion. Resolve the listed quotes before enabling foreign prices.`);
 if(!errors.length)try{validateWorkspace({...next,budgets:[]});}catch(e){errors.push((e as Error).message);}
 const bytes=new TextEncoder().encode(JSON.stringify(['investment-market-pricing',owner,revision,c.enabled,asOf])),receipt=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
 if(c.mode==='commit'){
  if(c.expectedRevision!==revision||c.receipt!==receipt)throw new ApiError(409,'Your workspace, date or pricing choice changed. Preview it again.');
  if(errors.length)throw new ApiError(400,errors[0]);
  if((state.profile.marketFx===1)===c.enabled)return {message:'This pricing choice is already saved.'};
  await commitMutation(owner,revision,[database().prepare('UPDATE profiles SET market_fx=? WHERE owner_id=?').bind(c.enabled?1:0,owner),...marketStatementReviews(owner,state,next)],6);
  return {message:c.enabled?'Foreign dated price valuation enabled. Recorded trade cash and basis are unchanged.':'Using account-currency price observations. Recorded foreign trade and holding evidence remains.'};
 }
 const accounts=state.accounts.filter(a=>['investment','crypto'].includes(a.type)),offset=accounts.length?Math.min(Math.floor(c.offset/25)*25,Math.floor((accounts.length-1)/25)*25):0;
 const safeBalance=(value:FinanceState,a:typeof accounts[number])=>{try{return investmentAccountBalance(a,value,asOf);}catch{return null;}};
 return {enabled:c.enabled,asOf,ready:!errors.length,errors,expectedRevision:revision,receipt,points:review.points,zeroPoints:review.zeroPoints,issueCount:c.enabled?review.issueCount:0,issues:c.enabled?review.issues:[],omittedIssues:c.enabled?Math.max(0,review.issueCount-review.issues.length):0,offset,total:accounts.length,limit:25,accounts:accounts.slice(offset,offset+25).map(a=>({id:a.id,name:a.name,currency:a.currency,before:safeBalance(state,a),after:errors.length?null:safeBalance(next,a)}))};
}
