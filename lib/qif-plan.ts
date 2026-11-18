import {z} from 'zod';
import {parseQIF,QIF_BUYS,QIF_SELLS,QIF_INFLOWS,QIF_DATE_FORMATS,type ParsedQIF,type QIFInvestment,type QIFDateFormat} from './qif-parser.ts';
import {ACCOUNT_TYPES,CURRENCIES,accountBalance,liability,parseMoney,precision,sumMinorUnits,today,validDate,type Account,type AccountType,type Currency,type FinanceState} from './finance.ts';
import {canonicalDecimal,decimalAtoms,decimalString,quantityValue,QTY_SCALE,PRICE_SCALE} from './decimal.ts';
import {csvDigest} from './csv-digest.ts';
import {canonicalCSVEntityMappings,csvEntityMappingsSchema,prepareNamedEntities,CSV_LABEL_COLOR,type CSVEntityChoice} from './csv-entity-mapping.ts';
import {securityFields} from './investment-schema.ts';
import {validateBaseTrade} from './investment-trade.ts';
import {validateWorkspace,workspaceState,type WorkspaceData} from './workspace.ts';
import {transferReportingEffects} from './transfer-report-effects.ts';
import {tradeAccountChanges,tradePositionChanges} from './trade-csv-plan.ts';
import {nativeMergeReview} from './native-merge-review.ts';
import type {NativeMergeChange} from './native-merge.ts';

const sourceName=z.string().min(1).max(2000).nullable(),id=z.string().uuid();
export const qifAccountChoiceSchema=z.discriminatedUnion('mode',[
  z.object({sourceName,mode:z.literal('existing'),targetId:id}).strict(),
  z.object({sourceName,mode:z.literal('create'),name:z.string().trim().min(1).max(160),type:z.enum(ACCOUNT_TYPES),currency:z.enum(CURRENCIES)}).strict(),
]);
export const qifSecurityChoiceSchema=z.discriminatedUnion('mode',[
  z.object({sourceKey:z.string().min(1).max(4100),mode:z.literal('existing'),targetId:id}).strict(),
  z.object({sourceKey:z.string().min(1).max(4100),mode:z.literal('create'),...securityFields,kind:z.literal('standard').default('standard')}).strict(),
]);
export const qifConfigurationSchema=z.object({dateFormat:z.enum(QIF_DATE_FORMATS.map(f=>f.value) as [QIFDateFormat,...QIFDateFormat[]]),signage:z.enum(['inflows-positive','outflows-positive']).default('inflows-positive'),accounts:z.array(qifAccountChoiceSchema).max(500),securities:z.array(qifSecurityChoiceSchema).max(2000),entities:csvEntityMappingsSchema}).strict().superRefine((c,ctx)=>{
  if(new Set(c.accounts.map(a=>a.sourceName)).size!==c.accounts.length)ctx.addIssue({code:'custom',message:'Map each QIF account once.'});
  if(new Set(c.securities.map(s=>s.sourceKey)).size!==c.securities.length)ctx.addIssue({code:'custom',message:'Map each QIF security once.'});
});
export type QIFConfiguration=z.infer<typeof qifConfigurationSchema>;
export function canonicalQIFConfiguration(input:QIFConfiguration){const c=qifConfigurationSchema.parse(input);c.accounts.sort((a,b)=>JSON.stringify(a.sourceName).localeCompare(JSON.stringify(b.sourceName)));c.securities.sort((a,b)=>a.sourceKey.localeCompare(b.sourceKey));c.entities=canonicalCSVEntityMappings(c.entities);if(new TextEncoder().encode(JSON.stringify(c)).length>1_000_000)throw new Error('QIF choices exceed 1 MB. Split this original before importing.');return c;}
const tradeAction=(action:string)=>([...QIF_BUYS,...QIF_SELLS] as readonly string[]).includes(action);
const buy=(action:string)=>(QIF_BUYS as readonly string[]).includes(action);
export const qifSecurityKey=(t:Pick<QIFInvestment,'securityName'|'securityTicker'>)=>JSON.stringify([t.securityName,t.securityTicker]);
const accountType=(type:string|null):AccountType=>type==='CCard'?'credit':type==='Invst'?'investment':type==='Oth A'?'other':type==='Oth L'?'other_liability':'checking';
const beforeDay=(date:string)=>new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
const twoYearsBefore=(date:string)=>{const d=new Date(date+'T00:00:00Z'),day=d.getUTCDate();d.setUTCFullYear(d.getUTCFullYear()-2);if(d.getUTCDate()!==day)d.setUTCDate(0);return d.toISOString().slice(0,10);};
function money(text:string|null,currency:Currency){if(text===null)throw new Error('The QIF amount is missing or invalid.');return parseMoney(text.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''),currency)||0;}
const rowContent=(row:{[key:string]:unknown})=>JSON.stringify(Object.fromEntries(Object.entries(row).filter(([key])=>key!=='ownerId').sort(([a],[b])=>a.localeCompare(b))));
function decimal(text:string|null,scale:number){return canonicalDecimal((text??'0').replace(/\.$/,''),scale);}
async function identity(seed:string,kind:string,key:unknown){const h=await csvDigest(JSON.stringify(['qif-v1',seed,kind,key]));return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
function inputAccounts(p:ParsedQIF){const result=new Map<string|null,{sourceName:string|null;type:AccountType;declaredTypes:string[];entryCount:number;openingCount:number}>();
  const add=(sourceName:string|null,type:string|null)=>{let a=result.get(sourceName);if(!a){a={sourceName,type:accountType(type),declaredTypes:[],entryCount:0,openingCount:0};result.set(sourceName,a);}if(type&&!a.declaredTypes.includes(type))a.declaredTypes.push(type);return a;};
  for(const a of p.accounts)add(a.name,a.accountType);for(const row of [...p.transactions,...p.investments])add(row.accountName,row.accountType).entryCount++;for(const row of p.openings)add(row.accountName,row.accountType).openingCount++;return [...result.values()];
}
export function qifCatalog(content:string,state:FinanceState,dateFormat?:QIFDateFormat,asOf=today()){
  const parsed=parseQIF(content,{dateFormat,asOf}),accounts=inputAccounts(parsed),categories=new Set<string>(),tags=new Set<string>(),securities=new Map<string,{sourceKey:string;name:string|null;ticker:string|null;rows:number}>();
  for(const row of [...parsed.transactions,...parsed.investments.filter(t=>!tradeAction(t.action))]){if(row.category)categories.add(row.category);for(const t of row.tags)tags.add(t);}
  for(const row of parsed.transactions)for(const line of row.splitLines){if(line.category)categories.add(line.category);for(const tag of line.tags)tags.add(tag);}
  for(const row of parsed.investments.filter(t=>tradeAction(t.action))){const key=qifSecurityKey(row),s=securities.get(key)??{sourceKey:key,name:row.securityName,ticker:row.securityTicker,rows:0};s.rows++;securities.set(key,s);}
  if(!accounts.length)throw new Error('The QIF contains no supported accounts, opening balances or financial entries.');
  if(accounts.length>500||securities.size>2000||categories.size>2000||tags.size>2000)throw new Error('Map at most 500 accounts and 2000 of each security/category/tag kind.');
  const label=(sourceName:string,kind:'categories'|'tags'):CSVEntityChoice=>{const leaf=kind==='categories'&&sourceName.includes(':')?sourceName.slice(sourceName.indexOf(':')+1).trim():sourceName,existing=state[kind].find(x=>x.name===leaf);return existing?{sourceName,mode:'existing',targetId:existing.id}:{sourceName,mode:'create',name:sourceName,color:CSV_LABEL_COLOR};};
  // Suggestions are editable. Ambiguous account/security names require explicit choices.
  const suggestions={dateFormat:parsed.dateFormat,signage:'inflows-positive' as const,accounts:accounts.map(a=>{const matches=state.accounts.filter(x=>!x.archived&&x.name===a.sourceName);return matches.length===1?{sourceName:a.sourceName,mode:'existing' as const,targetId:matches[0].id}:{sourceName:a.sourceName,mode:'create' as const,name:a.sourceName??'QIF account',type:a.type,currency:state.profile?.currency??'USD'};}),securities:[...securities.values()].map(s=>{const matches=state.securities.filter(x=>x.kind!=='cash'&&x.ticker.toUpperCase()===s.ticker?.toUpperCase());return matches.length===1?{sourceKey:s.sourceKey,mode:'existing' as const,targetId:matches[0].id}:{sourceKey:s.sourceKey,mode:'create' as const,ticker:s.ticker??'',name:s.name??s.ticker??'',exchange:'',kind:'standard' as const,websiteUrl:null};}),entities:{categories:[...categories].sort().map(n=>label(n,'categories')),tags:[...tags].sort().map(n=>label(n,'tags'))}};
  return {parsed,accounts,securities:[...securities.values()],names:{categories:[...categories].sort(),tags:[...tags].sort()},suggestions};
}
export function qifTradeQuantityLabel(qty:string){const atoms=decimalAtoms(qty,QTY_SCALE),value=decimalString(atoms<0n?-atoms:atoms,QTY_SCALE);return value.includes('.')?value:value+'.0';}
export function qifCashName(t:QIFInvestment){const security=t.securityName,payee=t.payee;if(payee)return payee;const names:Record<string,string>={Div:'Dividend',IntInc:'Interest',XIn:'Cash Transfer In',XOut:'Cash Transfer Out',CGLong:'Capital Gain (Long)',CGShort:'Capital Gain (Short)',MiscInc:'Miscellaneous Income',MiscExp:'Miscellaneous Expense'};if(['MiscInc','MiscExp'].includes(t.action)&&t.memo)return t.memo;const name=names[t.action]??t.action;return security&&['Div','IntInc','CGLong','CGShort'].includes(t.action)?name+': '+security:name;}

export async function planQIFImport(current:FinanceState,content:string,input:QIFConfiguration,seed:string,asOf=today()){
  if(!current.profile)throw new Error('Create your workspace first.');if(!validDate(asOf))throw new Error('Choose a valid QIF review day.');
  const beforeData=validateWorkspace({...current,budgets:[]}),configuration=canonicalQIFConfiguration(input),catalog=qifCatalog(content,current,configuration.dateFormat,asOf),p=catalog.parsed,owner=current.profile.ownerId;
  if(JSON.stringify(configuration.accounts.map(a=>a.sourceName).sort())!==JSON.stringify(catalog.accounts.map(a=>a.sourceName).sort()))throw new Error('Choose every source account once, without unused choices.');
  if(JSON.stringify(configuration.securities.map(a=>a.sourceKey).sort())!==JSON.stringify(catalog.securities.map(a=>a.sourceKey).sort()))throw new Error('Choose every referenced trade security once, without unused choices.');
  const prepared=await prepareNamedEntities(current,catalog.names,configuration.entities,seed),next=structuredClone({...prepared.state,budgets:[]}) as FinanceState,accountIds=new Map<string|null,string>(),securityIds=new Map<string,string>(),warnings:{line:number|null;message:string}[]=[],provenance:{line:number;collection:'transactions'|'trades';id:string;sourceAccount:string|null;targetAccount:string;currency:Currency;date:string;name:string;amount:number;qty?:string;price?:string;activity?:string;action:string|null;rawAmount:string|null;rawQuantity?:string|null;rawPrice?:string|null;checkNum?:string|null;cleared?:string|null}[]=[],openingChanges:{accountId:string;accountName:string;currency:Currency;sourceName:string|null;sourceLine:number|null;rawOpeningAmount:string|null;action:string;beforeDate:string;afterDate:string;beforeAmount:number;afterAmount:number;beforeAnchorDate:string;afterAnchorDate:string;beforeAnchorAmount:number;afterAnchorAmount:number;reason:string|null}[]=[];
  const createdAccounts:string[]=[],usedTargets=new Set<string>(),seenNewNames=new Set<string>();
  for(const c of configuration.accounts){if(c.mode==='existing'){const a=next.accounts.find(a=>a.id===c.targetId);if(!a||a.archived)throw new Error('Choose an active account from your current workspace.');if(usedTargets.has(a.id))throw new Error('Choose distinct target accounts so opening balances stay unambiguous.');accountIds.set(c.sourceName,a.id);usedTargets.add(a.id);}else{if(seenNewNames.has(c.name)||next.accounts.some(a=>a.name===c.name))throw new Error('A requested account name already exists. Select that existing account or choose a different name.');seenNewNames.add(c.name);const id=await identity(seed,'account',c.sourceName),a:Account={id,ownerId:owner,name:c.name,type:c.type,currency:c.currency,openingDate:twoYearsBefore(asOf)<'1900-01-01'?'1900-01-01':twoYearsBefore(asOf),openingBalance:0,archived:0,excludedFromReports:0};next.accounts.push(a);createdAccounts.push(id);accountIds.set(c.sourceName,id);}}
  for(const c of configuration.securities){if(c.mode==='existing'){const s=next.securities.find(s=>s.id===c.targetId);if(!s||s.kind==='cash')throw new Error('Choose an existing non-cash security from your workspace.');securityIds.set(c.sourceKey,s.id);}else{const existing=next.securities.find(s=>s.ticker.toUpperCase()===c.ticker.toUpperCase()&&s.exchange.toUpperCase()===c.exchange.toUpperCase());if(existing){if(existing.kind==='cash')throw new Error('A requested security conflicts with an existing cash instrument.');securityIds.set(c.sourceKey,existing.id);warnings.push({line:null,message:`The manual ${c.ticker} / ${c.exchange||'no exchange'} definition already exists and is reused without changing its metadata.`});}else{const id=await identity(seed,'security',[c.ticker.toUpperCase(),c.exchange.toUpperCase()]);next.securities.push({id,ownerId:owner,ticker:c.ticker,name:c.name,exchange:c.exchange,kind:'standard',websiteUrl:c.websiteUrl});securityIds.set(c.sourceKey,id);}}}
  const categoryId=(label:string)=>label?prepared.categoryTargets.get(label)?.id??null:null,tagIds=(labels:string[])=>[...new Set(labels.flatMap(n=>prepared.tagTargets.get(n)?[prepared.tagTargets.get(n)!.id]:[]))],target=(sourceName:string|null)=>{const id=accountIds.get(sourceName);if(!id)throw new Error('A QIF row has no chosen target account.');return next.accounts.find(a=>a.id===id)!;},checkDate=(date:string,line:number,opening=false)=>{if(!validDate(date))throw new Error(`QIF line ${line}: choose a date format that yields a supported 1900–2199 calendar date.`);if(!opening&&date>asOf)throw new Error(`QIF line ${line}: financial entries cannot be dated after the review day.`);};
  const ordinary=async(row:ParsedQIF['transactions'][number]|QIFInvestment,index:number,investment=false)=>{checkDate(row.date,row.line);const a=target(row.accountName),amount=money(investment?row.amount??'0':row.amount,a.currency)*(investment?((QIF_INFLOWS as readonly string[]).includes((row as QIFInvestment).action)?1:-1):configuration.signage==='inflows-positive'?1:-1),id=await identity(seed,'transaction',index),name=investment?qifCashName(row as QIFInvestment):row.payee||'Imported item';
    next.transactions.push({id,ownerId:owner,accountId:a.id,date:row.date,name,amount:amount||0,categoryId:categoryId(row.category),tagIds:tagIds(row.tags),notes:row.memo??'',kind:'standard',transferId:null,importKey:null,excluded:0,merchantId:null,lockedFields:[],investmentActivity:null,reconciledStatus:'unreconciled',reconciledAt:null,reconciledStatementId:null});
    provenance.push({line:row.line,collection:'transactions',id,sourceAccount:row.accountName,targetAccount:a.name,currency:a.currency,date:row.date,name,amount:amount||0,action:investment?(row as QIFInvestment).action:null,rawAmount:row.amount,...(!investment?{checkNum:(row as ParsedQIF['transactions'][number]).checkNum,cleared:(row as ParsedQIF['transactions'][number]).cleared}:{})});return {id,a,amount};};
  for(const [index,row] of p.transactions.entries()){
    const t=await ordinary(row,index);if(!row.splitLines.length)continue;const amounts=row.splitLines.map(l=>money(l.amount,t.a.currency)*(configuration.signage==='inflows-positive'?1:-1));
    if(sumMinorUnits(amounts)!==t.amount){warnings.push({line:row.line,message:'Split lines do not add up to their parent. Following Sure, the full parent is imported without its split lines; the original retains the unmatched split evidence.'});continue;}
    if(row.splitLines.length<2){warnings.push({line:row.line,message:'The QIF has only one valid split line. The parent is retained without a split.'});continue;}
    for(const [position,line] of row.splitLines.entries())next.splitLines.push({id:await identity(seed,'split',[index,position]),ownerId:owner,transactionId:t.id,position,name:line.memo||line.category||row.payee||'Imported item',amount:amounts[position]||0,categoryId:categoryId(line.category),tagIds:tagIds(line.tags.length?line.tags:row.tags),notes:line.memo??'',kind:'standard',excluded:0,merchantId:null,lockedFields:[]});
  }
  for(const [index,row] of p.investments.entries()){
    if(!tradeAction(row.action)){await ordinary(row,p.transactions.length+index,true);continue;}checkDate(row.date,row.line);const a=target(row.accountName);if(!['investment','crypto'].includes(a.type))throw new Error(`QIF line ${row.line}: choose an investment or crypto account for its trades.`);
    const qty=decimalString(decimalAtoms(decimal(row.qty,QTY_SCALE),QTY_SCALE)*(buy(row.action)?1n:-1n),QTY_SCALE),price=decimal(row.price,PRICE_SCALE),cashAmount=money(row.amount??'0',a.currency)*(buy(row.action)?-1:1),securityId=securityIds.get(qifSecurityKey(row))!,id=await identity(seed,'trade',index),value=quantityValue(qty,price,precision(a.currency));let fee=0,activity:'buy'|'sell'|'unclassified'=buy(row.action)?'buy':'sell';
    const inferred=-BigInt(cashAmount)-BigInt(value);if(inferred>=0n&&inferred<=1_000_000_000_000n)fee=Number(inferred);
    const base={qty,price,fee,cashAmount:cashAmount||0,currency:a.currency,activity};try{validateBaseTrade(base);}catch{activity='unclassified';fee=0;warnings.push({line:row.line,message:'The original trade quantity, price and total do not form a supported buy/sell. They are retained as an unclassified trade; cost basis and performance need review.'});}
    if(row.qty===null||row.price===null||row.amount===null)warnings.push({line:row.line,message:'Missing quantity, price or total is interpreted as zero by Sure. Review every original field before approving this trade.'});
    const security=next.securities.find(s=>s.id===securityId)!,absolute=decimalString(decimalAtoms(qty,QTY_SCALE)<0n?-decimalAtoms(qty,QTY_SCALE):decimalAtoms(qty,QTY_SCALE),QTY_SCALE),name=`${buy(row.action)?'Buy':'Sell'} ${qifTradeQuantityLabel(absolute)} shares of ${row.securityTicker||row.securityName||'Unknown'}`;
    next.trades.push({id,ownerId:owner,accountId:a.id,securityId,date:row.date,name,qty,price,fee,cashAmount:cashAmount||0,currency:a.currency,activity,sequence:row.line,notes:row.memo??'',importKey:null,conversion:null,excluded:0});
    if(security.kind==='cash')throw new Error('QIF trades require non-cash manual securities.');provenance.push({line:row.line,collection:'trades',id,sourceAccount:row.accountName,targetAccount:a.name,currency:a.currency,date:row.date,name,amount:cashAmount||0,qty,price,activity,action:row.action,rawAmount:row.amount,rawQuantity:row.qty,rawPrice:row.price});
  }
  // Opening entries are valuations, never ordinary cash movements or claimed import entries.
  for(const [sourceName,accountId] of accountIds){
    const a=next.accounts.find(a=>a.id===accountId)!,oldDate=a.openingDate,oldAmount=a.openingBalance;
    const anchors=next.valuations.filter(v=>v.accountId===a.id&&v.kind==='opening_anchor'),anchor=anchors[0];
    if(anchors.length>1)throw new Error('The selected account has multiple opening anchors. Resolve its opening history before importing.');
    const candidates=p.openings.filter(o=>o.accountName===sourceName).slice(0,sourceName===null?1:undefined);
    const events=[...next.transactions,...next.trades,...next.holdingSnapshots,...next.investmentCashBalances,...next.valuations.filter(v=>v.id!==anchor?.id)].filter(r=>r.accountId===a.id);
    const earliest=events.map(r=>r.date).sort()[0],incoming=provenance.filter(r=>accountIds.get(r.sourceAccount)===a.id).map(r=>r.date).sort()[0];
    const priorDate=anchor?.date??oldDate,priorAmount=anchor?.amount??oldAmount;
    let date=priorDate,amount=priorAmount,action='retained',reason:string|null=null,opening=candidates[0];
    for(const candidate of candidates){
      checkDate(candidate.date,candidate.line,true);
      if(earliest&&candidate.date>=earliest){reason='Opening date must be strictly before the oldest non-opening entry. Sure retains the previous opening balance.';warnings.push({line:candidate.line,message:reason});}
      else{opening=candidate;date=candidate.date;amount=money(candidate.amount,a.currency)*(liability(a.type)?-1:1);amount=amount||0;action='set';}
    }
    if(!candidates.length&&incoming&&incoming<priorDate){
      const proposed=beforeDay(incoming);
      if(earliest&&proposed>=earliest){reason='The proposed backdated opening is not before existing history. Sure retains the previous opening anchor.';warnings.push({line:null,message:reason});}
      else{date=proposed;action='backdated';}
    }
    if(action==='retained'){
      if(incoming&&incoming<oldDate){
        // An ignored later anchor must not hide the newly imported earlier history.
        // Materialize the old implicit baseline as its prior dated total, including
        // preexisting same-day entries, so no earlier target history is rewritten.
        if(!next.valuations.some(v=>v.accountId===a.id&&v.date===oldDate)){
          const original=current.accounts.find(row=>row.id===a.id),total=original?accountBalance(original,current,oldDate):oldAmount;
          next.valuations.push({id:await identity(seed,'opening-preserved',sourceName),ownerId:owner,accountId:a.id,date:oldDate,amount:total,name:'Opening balance retained',kind:anchor?'history':'opening_anchor'});
        }
        a.openingDate=beforeDay(earliest);a.openingBalance=0;
        reason=(reason??'Opening anchor retained.')+' The zero historical baseline is extended to cover the earlier imported activity.';
      }else if(createdAccounts.includes(a.id)&&!anchor){
        next.valuations.push({id:await identity(seed,'opening',sourceName),ownerId:owner,accountId:a.id,date:oldDate,amount:oldAmount,name:'Opening balance',kind:'opening_anchor'});
      }
    }else{
      // An automatic move of a dated anchor preserves an older local implicit
      // baseline. An explicit opening selection replaces the opening definition.
      if(action==='set'||date<=oldDate){a.openingDate=date;a.openingBalance=amount;}
      if(anchor){anchor.date=date;anchor.amount=amount;}
      else next.valuations.push({id:await identity(seed,'opening',sourceName),ownerId:owner,accountId:a.id,date,amount,name:'Opening balance',kind:'opening_anchor'});
    }
    if(!validDate(a.openingDate)||!validDate(date))throw new Error('An opening balance would need a date before 1900. Split or correct that source history.');
    openingChanges.push({accountId:a.id,accountName:a.name,currency:a.currency,sourceName,sourceLine:opening?.line??null,rawOpeningAmount:opening?.amount??null,action,beforeDate:oldDate,afterDate:a.openingDate,beforeAmount:oldAmount,afterAmount:a.openingBalance,beforeAnchorDate:priorDate,afterAnchorDate:date,beforeAnchorAmount:priorAmount,afterAnchorAmount:amount,reason});
    if(sourceName!==null&&candidates.length>1)warnings.push({line:opening?.line??null,message:'Multiple named-account opening definitions are processed in section order. The final valid definition is applied; earlier definitions remain in the original.'});
    if(liability(a.type)&&candidates.length)warnings.push({line:opening?.line??null,message:'Opening balances follow Sure’s debt-positive convention: a positive source opening becomes a negative net asset balance for this liability account. Review the original sign.'});
    if(sourceName===null&&p.openings.filter(o=>o.accountName===null).length>1)warnings.push({line:opening?.line??null,message:'Following Sure’s single-account workflow, only the first unnamed opening balance is applied. Review the additional openings in the original.'});
  }
  for(const diagnostic of p.diagnostics)warnings.push({line:diagnostic.line,message:diagnostic.reason});
  if(current.rules.length)warnings.push({line:null,message:'Automatic rules are not run by this import. Review and apply rule proposals separately in Rules.'});
  for(const skipped of p.skipped)warnings.push({line:skipped.line,message:skipped.reason+'; this source record is not imported.'});
  for(const unsupported of p.unsupported)warnings.push({line:null,message:`Unsupported QIF section ${unsupported.type}: ${unsupported.records} records are not imported.`});
  if((p.types.Prices??0)>0)warnings.push({line:null,message:'QIF Prices records are not imported by Sure’s QIF workflow. Enter historical closes separately.'});
  const changedAccounts=[...accountIds.values()],changesOn=new Map<string,string>(),importedIds=new Set(provenance.map(p=>p.id));for(const row of [...next.transactions.filter(t=>importedIds.has(t.id)),...next.trades.filter(t=>importedIds.has(t.id)),...openingChanges.filter(o=>o.beforeDate!==o.afterDate||o.beforeAmount!==o.afterAmount||o.beforeAnchorDate!==o.afterAnchorDate||o.beforeAnchorAmount!==o.afterAnchorAmount).map(o=>({accountId:o.accountId,date:[o.beforeDate,o.afterDate,o.beforeAnchorDate,o.afterAnchorDate].sort()[0]}))])if(!changesOn.has(row.accountId)||row.date<changesOn.get(row.accountId)!)changesOn.set(row.accountId,row.date);
  for(const s of next.accountStatements)if(s.completedAt&&changesOn.has(s.accountId)&&changesOn.get(s.accountId)!<=s.periodEnd)s.reviewRequired=1;
  const data=validateWorkspace({...next,budgets:[]}),after=workspaceState(data),keys=Object.keys(data).filter(k=>k!=='profile') as Exclude<keyof WorkspaceData,'profile'>[],changes:NativeMergeChange[]=[],delta=structuredClone(data),created:Partial<Record<Exclude<keyof WorkspaceData,'profile'>,number>>={},updated:typeof created={};
  for(const collection of keys){const beforeRows=beforeData[collection] as unknown as {id:string;[k:string]:unknown}[],afterRows=data[collection] as unknown as {id:string;[k:string]:unknown}[],old=new Map(beforeRows.map(r=>[r.id,r]));for(const row of afterRows){const previous=old.get(row.id);if(!previous||rowContent(previous)!==rowContent(row)){changes.push({collection,id:row.id,name:String(row.name??row.ticker??row.date??row.id),before:previous??null,after:row});const count=previous?updated:created;count[collection]=(count[collection]??0)+1;}}(delta as unknown as Record<string,unknown>)[collection]=afterRows.filter(r=>!old.has(r.id));}
  const investmentAccounts=changedAccounts.filter(id=>['investment','crypto'].includes(after.accounts.find(a=>a.id===id)!.type));
  return {configuration,catalog,data,delta,changes,created,updated,provenance,openingChanges,warnings,ownership:{accounts:createdAccounts,transactions:delta.transactions.map(t=>t.id),trades:delta.trades.map(t=>t.id),valuations:[] as string[]},entities:prepared.resolved,accounts:changedAccounts.map(id=>{const a=after.accounts.find(a=>a.id===id)!,old=current.accounts.find(a=>a.id===id);return {id,name:a.name,currency:a.currency,before:old?accountBalance(old,current,asOf):null,after:accountBalance(a,after,asOf),created:!old,openingDate:a.openingDate,openingBalance:a.openingBalance};}),positions:tradePositionChanges(current,after,investmentAccounts,asOf),investmentAccounts:tradeAccountChanges(current,after,investmentAccounts,asOf),effects:transferReportingEffects(current,after,[...changesOn].map(([accountId,date])=>({accountId,date})),changedAccounts,asOf),closedStatements:data.accountStatements.filter(s=>s.completedAt&&s.reviewRequired&&changedAccounts.includes(s.accountId)).map(s=>({id:s.id,title:s.title})),reviewedOn:asOf};
}
export type QIFPlan=Awaited<ReturnType<typeof planQIFImport>>;
export interface QIFPages {offset?:number;accountOffset?:number;positionOffset?:number;effectOffset?:number;openingOffset?:number;warningOffset?:number;sourceOffset?:number;statementOffset?:number;investmentAccountOffset?:number;}
export function qifPlanPage(plan:QIFPlan,before:FinanceState,input:number|QIFPages=0){const c=typeof input==='number'?{offset:input}:input;for(const key of ['offset','accountOffset','positionOffset','effectOffset','openingOffset','warningOffset','sourceOffset','statementOffset','investmentAccountOffset'] as const){const value=c[key];if(value!==undefined&&(!Number.isSafeInteger(value)||value<0||value>(key==='warningOffset'?100000:40000)||value%25))throw new Error('Choose a supported QIF review page.');}const at=(key:keyof QIFPages)=>c[key]??0,pg=(key:keyof QIFPages,total:number)=>({offset:at(key),limit:25,total}),slice=<T>(key:keyof QIFPages,items:T[])=>items.slice(at(key),at(key)+25);return {created:plan.created,updated:plan.updated,changes:nativeMergeReview(slice('offset',plan.changes),before,plan.data),page:pg('offset',plan.changes.length),provenance:slice('sourceOffset',plan.provenance),sourcePage:pg('sourceOffset',plan.provenance.length),openingChanges:slice('openingOffset',plan.openingChanges),openingPage:pg('openingOffset',plan.openingChanges.length),accounts:slice('accountOffset',plan.accounts),accountPage:pg('accountOffset',plan.accounts.length),positions:slice('positionOffset',plan.positions),positionPage:pg('positionOffset',plan.positions.length),investmentAccounts:slice('investmentAccountOffset',plan.investmentAccounts),investmentAccountPage:pg('investmentAccountOffset',plan.investmentAccounts.length),effects:slice('effectOffset',plan.effects),effectPage:pg('effectOffset',plan.effects.length),closedStatements:slice('statementOffset',plan.closedStatements),statementPage:pg('statementOffset',plan.closedStatements.length),warnings:slice('warningOffset',plan.warnings),warningPage:pg('warningOffset',plan.warnings.length),reviewedOn:plan.reviewedOn,sourceCounts:{records:plan.catalog.parsed.recordCount,transactions:plan.catalog.parsed.transactions.length,investments:plan.catalog.parsed.investments.length,openings:plan.catalog.parsed.openings.length,skipped:plan.catalog.parsed.skipped.length}};}
