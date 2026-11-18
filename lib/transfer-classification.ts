import {accountBalance,monthlySummary,today,transferKind,type FinanceState} from './finance.ts';
import {transferReportingEffects,type TransferReportingEffect} from './transfer-report-effects.ts';
// Category names from the pinned Sure locales supported by LanguagesHelper.
export const INVESTMENT_CONTRIBUTION_NAMES=['Investment Contributions','Contributions aux investissements','Anlagebeiträge','Aportaciones a inversiones','Contributi investimento','Yatırım Katkıları',"Contribucions d'inversió",'Взносы в инвестиции','Wpłaty inwestycyjne','Contribuições para Investimentos','投资投入','投資投入金額','Investeringsbijdragen','Befektetési befizetések','Đóng góp đầu tư','Інвестиційні внески'] as const;
export type ClassificationEffect=TransferReportingEffect;
export function classificationPair(state:FinanceState,transferId:string){
  if(state.transferDetails.some(d=>d.id===transferId&&d.status==='pending'))throw new Error('Confirm the pending match before choosing contribution reporting.');
  const legs=state.transactions.filter(t=>t.transferId===transferId),out=legs.find(t=>t.amount<0),into=legs.find(t=>t.amount>0);if(legs.length!==2||!out||!into)throw new Error('Transfer pair not found.');
  const from=state.accounts.find(a=>a.id===out.accountId),to=state.accounts.find(a=>a.id===into.accountId);if(!from||!to)throw new Error('Transfer account not found.');
  if(transferKind(from.type,to.type)!=='investment_contribution')throw new Error('This control applies to transfers from a non-investment account into an investment or crypto account.');
  if(from.archived||to.archived)throw new Error('Restore both accounts before changing transfer reporting.');
  return {out,into,from,to};
}
export function planTransferClassification(state:FinanceState,transferId:string,enabled:boolean,asOf=today(),newCategoryId='review-contribution-category'){
  const {out,into,from,to}=classificationPair(state,transferId),next=structuredClone(state),target=next.transactions.find(t=>t.id===out.id)!;
  const categoryBefore=state.categories.find(c=>c.id===out.categoryId),kind=enabled?'investment_contribution':'funds_movement';let categoryToCreate:FinanceState['categories'][number]|null=null;
  target.kind=kind;target.lockedFields=[...new Set([...(target.lockedFields??[]),'kind' as const])];
  if(enabled&&!target.categoryId){let category=next.categories.find(c=>c.name==='Investment Contributions');if(!category){category={id:newCategoryId,ownerId:out.ownerId,name:'Investment Contributions',color:'#0d9488',parentId:null};categoryToCreate=category;next.categories.push(category);}target.categoryId=category.id;}
  else if(!enabled&&categoryBefore&&INVESTMENT_CONTRIBUTION_NAMES.some(name=>name===categoryBefore.name))target.categoryId=null;
  const categoryAfter=next.categories.find(c=>c.id===target.categoryId),changed=target.kind!==out.kind||target.categoryId!==out.categoryId||!out.lockedFields?.includes('kind');
  const effects=changed?transferReportingEffects(state,next,[{accountId:out.accountId,date:out.date}],[from.id,to.id],asOf):[];

  const beforeMonth=monthlySummary(state,from.currency,out.date.slice(0,7),asOf),afterMonth=monthlySummary(next,from.currency,out.date.slice(0,7),asOf);
  return {next,categoryToCreate,outflow:target,review:{transferId,enabled,currentlyEnabled:out.kind==='investment_contribution',protectedBefore:!!out.lockedFields?.includes('kind'),protectedAfter:true,changed,reviewedOn:asOf,from:{id:from.id,name:from.name,currency:from.currency,date:out.date,amount:out.amount,balanceBefore:accountBalance(from,state,asOf),balanceAfter:accountBalance(from,next,asOf)},to:{id:to.id,name:to.name,currency:to.currency,date:into.date,amount:into.amount,balanceBefore:accountBalance(to,state,asOf),balanceAfter:accountBalance(to,next,asOf)},kindBefore:out.kind,kindAfter:target.kind,categoryBefore:categoryBefore?.name??null,categoryAfter:categoryAfter?.name??null,categoryCreated:!!categoryToCreate,month:out.date.slice(0,7),monthlySpendingBefore:beforeMonth.expenses,monthlySpendingAfter:afterMonth.expenses,closedStatements:target.kind===out.kind?[]:state.accountStatements.filter(s=>s.accountId===from.id&&s.completedAt&&s.periodEnd>=out.date).map(s=>({id:s.id,title:s.title})),effects,totalEffects:effects.length}};
}
export function classificationPage(report:ReturnType<typeof planTransferClassification>['review'],offset=0){if(!Number.isSafeInteger(offset)||offset<0||offset%25||offset>20000||offset!==0&&offset>=report.totalEffects)throw new Error('Choose an available page of classification effects.');return {...report,effects:report.effects.slice(offset,offset+25),offset};}
export type TransferClassificationReview=ReturnType<typeof classificationPage>&{receipt:string;expectedRevision:number};
