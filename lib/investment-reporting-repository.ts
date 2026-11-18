import {investmentReportingCommand} from './investment-reporting-schema';
import {ApiError,commitMutation,database,readState} from './repository';
export async function executeInvestmentReporting(owner:string,input:unknown,revision:number){
 if(!input||typeof input!=='object'||!('action' in input)||input.action!=='investmentReporting')return null;
 const parsed=investmentReportingCommand.safeParse(input);if(!parsed.success)throw new ApiError(400,'Choose a valid investment reporting label or exclusion.');const c=parsed.data;
 if(c.expectedRevision!==revision)throw new ApiError(409,'Your workspace changed. Reload before changing reporting.');
 const state=await readState(owner);if(state.profile?.revision!==revision)throw new ApiError(409,'Your workspace changed. Reload before changing reporting.');
 if(c.source==='transaction'){
  if(c.investmentActivity===undefined||c.excluded!==undefined)throw new ApiError(400,'Choose the cash activity label. Change cash exclusions in the transaction editor.');
  const row=state.transactions.find(row=>row.id===c.id);if(!row)throw new ApiError(404,'Cash entry not found.');
  if((row.investmentActivity??null)===c.investmentActivity)return {message:'Cash activity label is unchanged.'};
  await commitMutation(owner,revision,[database().prepare('UPDATE transactions SET investment_activity=? WHERE owner_id=? AND id=?').bind(c.investmentActivity,owner,row.id)]);
 }else{
  if(c.excluded===undefined||c.investmentActivity!==undefined)throw new ApiError(400,'Choose whether to exclude this investment activity.');
  const row=state.trades.find(row=>row.id===c.id);if(!row)throw new ApiError(404,'Investment activity not found.');
  if(row.excluded!==undefined&&row.excluded!==null&&!!row.excluded===c.excluded)return {message:'Investment exclusion is unchanged.'};
  await commitMutation(owner,revision,[database().prepare('UPDATE trades SET excluded=? WHERE owner_id=? AND id=?').bind(+c.excluded,owner,row.id)]);
 }
 return {message:'Investment reporting updated. Recorded money, shares and statement evidence were retained.'};
}
