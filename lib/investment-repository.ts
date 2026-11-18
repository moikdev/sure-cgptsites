import {convertForeignTrade,convertForeignHolding} from './investment-fx';
import {investmentImportRows} from "./investment-csv";
import {createInvestmentCSVTemplate} from './investment-csv-mapping';
import {investmentCSVTemplateStatements} from './investment-csv-template-repository';
import {ApiError,commitMutation,database,readState} from './repository';
import {investmentCommandSchema} from './investment-schema';
import {investmentCollections,investmentColumns,investmentValues,type InvestmentCollection} from './investment-persistence';
import {validateWorkspace} from './workspace';
import {quantityValue} from './decimal';
import {precision,type FinanceState} from './finance';
import type {InvestmentCashBalance} from './investment-types';
export async function executeInvestmentCommand(owner:string,input:unknown,revision:number):Promise<{message:string}|null>{
 const parsed=investmentCommandSchema.safeParse(input);if(!parsed.success)return null;
 const c=parsed.data,db=database(),state=await readState(owner);if(state.profile?.revision!==revision)throw new ApiError(409,'Your workspace changed. Reload and try again.');
 if(c.action==='investmentImport'&&c.expectedRevision!==undefined&&c.expectedRevision!==revision)throw new ApiError(409,'Your workspace changed. Review this investment CSV again.');
 const next=structuredClone(state),statements:D1PreparedStatement[]=[];let imported=false,financialChanged=false;
 const find=(key:InvestmentCollection,id:string)=>{const found=state[key].find(row=>row.id===id);if(!found)throw new ApiError(404,'Investment record not found.');return found;};
 const account=(id:string,date:string,currency?:string)=>{const a=state.accounts.find(a=>a.id===id);if(!a)throw new ApiError(404,'Account not found.');if(!['investment','crypto'].includes(a.type))throw new ApiError(400,'Choose an investment or crypto account.');if(a.archived)throw new ApiError(400,'Restore the account before editing its investment records.');if(date<a.openingDate)throw new ApiError(400,'The date precedes this account’s opening date.');if(currency&&currency!==a.currency)throw new ApiError(400,'Use the account currency. Cross-currency investments require the FX workflow.');return a;};
 const security=(id:string)=>{if(!state.securities.some(s=>s.id===id))throw new ApiError(404,'Security not found.');};
 const save=<T extends {id:string;ownerId:string}>(key:InvestmentCollection,row:T)=>{
  const meta=investmentCollections[key],columns=investmentColumns(key),values=investmentValues(key,row),rows=next[key] as unknown as T[];
  const index=rows.findIndex(old=>old.id===row.id);if(index>=0&&investmentValues(key,rows[index]).every((v,i)=>v===values[i]))return;financialChanged=true;if(index>=0)rows[index]=row;else rows.push(row);
  statements.push(index>=0?db.prepare(`UPDATE ${meta.table} SET ${columns.slice(2).map(col=>`${col}=?`).join(',')} WHERE owner_id=? AND id=?`).bind(...values.slice(2),owner,row.id):db.prepare(`INSERT INTO ${meta.table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...values));
 };
 const remove=(key:InvestmentCollection,id:string)=>{find(key,id);(next[key] as {id:string}[])=(next[key] as {id:string}[]).filter(row=>row.id!==id);statements.push(db.prepare(`DELETE FROM ${investmentCollections[key].table} WHERE owner_id=? AND id=?`).bind(owner,id));};
 switch(c.action){
 case 'investmentImport': {
  try{
   const rows=await investmentImportRows(state,c);
   for(let i=0;i<rows.newAccounts.length;i+=16){const group=rows.newAccounts.slice(i,i+16);next.accounts.push(...group);financialChanged=true;statements.push(db.prepare(`INSERT INTO accounts(id,owner_id,name,type,currency,opening_balance,opening_date,archived,excluded_from_reports,cash_planning_excluded) VALUES ${group.map(()=>'(?,?,?,?,?,0,?,0,0,NULL)').join(',')}`).bind(...group.flatMap(a=>[a.id,owner,a.name,a.type,a.currency,a.openingDate])));}
   for(let i=0;i<rows.trades.length;i+=5){const group=rows.trades.slice(i,i+5),columns=investmentColumns('trades');next.trades.push(...group);financialChanged=true;statements.push(db.prepare(`INSERT INTO trades(${columns.join(',')}) VALUES ${group.map(()=>'('+columns.map(()=>'?').join(',')+')').join(',')}`).bind(...group.flatMap(row=>investmentValues('trades',row))));}
   for(const key of ['holdingSnapshots','securityPrices'] as const)for(const row of rows[key])save(key,row);
   const template=createInvestmentCSVTemplate(c.csv,c.kind,c.csvOptions),accountIds=c.kind==='trades'&&c.accountId===null?[...new Set(rows.accountMappings.map(m=>m.accountId))]:[c.accountId];statements.push(...investmentCSVTemplateStatements(owner,c.kind,accountIds,template));imported=true;
  }catch(error){throw new ApiError(400,(error as Error).message);}break;
 }

 case 'security': {if(c.id)find('securities',c.id);const ticker=c.ticker.toUpperCase(),exchange=c.exchange.toUpperCase();if(state.securities.some(s=>s.id!==c.id&&s.ticker.toUpperCase()===ticker&&s.exchange.toUpperCase()===exchange))throw new ApiError(409,'This ticker and exchange already exist.');save('securities',{...c,ticker,exchange,id:c.id??crypto.randomUUID(),ownerId:owner});break;}
 case 'deleteSecurity': {find('securities',c.id);if(state.trades.some(t=>t.securityId===c.id)||state.holdingSnapshots.some(h=>h.securityId===c.id))throw new ApiError(409,'Remove this security’s trades and holding snapshots before deleting it.');next.securityPrices=next.securityPrices.filter(p=>p.securityId!==c.id);next.securitySplits=next.securitySplits.filter(p=>p.securityId!==c.id);remove('securities',c.id);break;}
 case 'securityPrice': {security(c.securityId);if(c.id)find('securityPrices',c.id);const duplicate=state.securityPrices.find(p=>p.securityId===c.securityId&&p.date===c.date&&p.currency===c.currency);if(c.id&&duplicate&&duplicate.id!==c.id)throw new ApiError(409,'A price for this security, date and currency already exists.');save('securityPrices',{...c,id:c.id??duplicate?.id??crypto.randomUUID(),ownerId:owner});break;}
 case 'deleteSecurityPrice':remove('securityPrices',c.id);break;
 case 'trade': case 'foreignTrade': {
  const foreign=c.action==='foreignTrade';if(c.conversion)throw new ApiError(400,'Use the foreign investment fields to record conversion evidence.');
  if(!c.id&&!c.requestId)throw new ApiError(400,'A new trade needs a payment request ID.');const id=c.id??c.requestId!,prior=!c.id?state.trades.find(t=>t.id===id):null;
  const fingerprint=foreign?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([c.accountId,c.securityId,c.date,c.name,c.qty,c.price,c.fee,c.cashAmount,c.currency,c.activity,c.sequence,c.notes,c.importKey,c.exchangeRate??null])))),b=>b.toString(16).padStart(2,'0')).join(''):null;
  if(prior&&foreign){if(prior.conversion?.requestFingerprint!==fingerprint)throw new ApiError(409,'This trade request was already used with different details.');return {message:'This trade was already recorded.'};}
  const a=account(c.accountId,c.date,foreign?undefined:c.currency);security(c.securityId);const previous=c.id?find('trades',c.id) as FinanceState['trades'][number]:undefined;if(!foreign&&previous?.conversion)throw new ApiError(400,'Edit this activity with its original foreign-currency fields.');
  let normalized;try{normalized=foreign?convertForeignTrade(state,c,a.currency,c.exchangeRate,previous?.conversion):c;}catch(e){throw new ApiError(400,(e as Error).message);}
  const row={...c,...normalized,excluded:c.excluded===undefined?(previous??prior)?.excluded:c.excluded,id,ownerId:owner};if(foreign&&row.conversion)row.conversion={...row.conversion,requestFingerprint:c.id?null:fingerprint};
  if(prior){if(investmentValues('trades',prior).some((value,i)=>value!==investmentValues('trades',row)[i]))throw new ApiError(409,'This trade request was already used with different details.');return {message:'This trade was already recorded.'};}save('trades',row);break;
 }
 case 'deleteTrade': {const row=find('trades',c.id) as FinanceState['trades'][number];account(row.accountId,row.date);remove('trades',c.id);break;}
 case 'holding': case 'foreignHolding': {
  const foreign=c.action==='foreignHolding',a=account(c.accountId,c.date,foreign?undefined:c.currency);security(c.securityId);if(c.id)find('holdingSnapshots',c.id);
  const duplicate=state.holdingSnapshots.find(h=>h.accountId===c.accountId&&h.securityId===c.securityId&&h.date===c.date);if(c.id&&duplicate&&duplicate.id!==c.id)throw new ApiError(409,'A holding snapshot for this security and date already exists.');const previous=c.id?state.holdingSnapshots.find(h=>h.id===c.id):duplicate;
  if(c.conversion)throw new ApiError(400,'Use the foreign holding fields to record conversion evidence.');if(!foreign&&previous?.conversion)throw new ApiError(400,'Edit this holding with its original foreign-currency fields.');
  let normalized;try{if(foreign)normalized=convertForeignHolding(state,c,a.currency,c.exchangeRate,previous?.conversion);else{const retained=previous&&previous.qty===c.qty&&previous.price===c.price&&previous.currency===c.currency&&previous.amount===c.amount;if(!retained&&quantityValue(c.qty,c.price,precision(a.currency))!==c.amount)throw new Error('The holding value must equal its share quantity and unit price.');normalized=c;}}catch(e){throw new ApiError(400,(e as Error).message);}
  save('holdingSnapshots',{...c,...normalized,id:c.id??duplicate?.id??crypto.randomUUID(),ownerId:owner});
  if(c.cashBalance!==undefined){const existing=state.investmentCashBalances.find(b=>b.accountId===a.id&&b.date===c.date);const cash:InvestmentCashBalance={id:existing?.id??crypto.randomUUID(),ownerId:owner,accountId:a.id,date:c.date,amount:c.cashBalance};save('investmentCashBalances',cash);}break;
 }
 case 'deleteHolding': {const row=find('holdingSnapshots',c.id) as FinanceState['holdingSnapshots'][number];account(row.accountId,row.date);remove('holdingSnapshots',c.id);break;}
 case 'securitySplit': {security(c.securityId);if(c.id)find('securitySplits',c.id);const duplicate=state.securitySplits.find(s=>s.securityId===c.securityId&&s.date===c.date);if(c.id&&duplicate&&duplicate.id!==c.id)throw new ApiError(409,'A stock split already exists on this date.');save('securitySplits',{...c,id:c.id??duplicate?.id??crypto.randomUUID(),ownerId:owner});break;}
 case 'deleteSecuritySplit':remove('securitySplits',c.id);break;
 case 'investmentCash': {account(c.accountId,c.date);if(c.id)find('investmentCashBalances',c.id);const duplicate=state.investmentCashBalances.find(b=>b.accountId===c.accountId&&b.date===c.date);if(c.id&&duplicate&&duplicate.id!==c.id)throw new ApiError(409,'A cash balance already exists for this date.');save('investmentCashBalances',{...c,id:c.id??duplicate?.id??crypto.randomUUID(),ownerId:owner});break;}
 case 'deleteInvestmentCash': {const row=find('investmentCashBalances',c.id) as InvestmentCashBalance;account(row.accountId,row.date);remove('investmentCashBalances',c.id);break;}
 }
 try{validateWorkspace(next);}catch(error){throw new ApiError(400,(error as Error).message);}
 await commitMutation(owner,revision,statements,8,{incrementRevision:!imported||financialChanged});return {message:imported?'Investment CSV imported. Completed column settings are saved for each target account and import type.':'Investment records saved.'};
}
