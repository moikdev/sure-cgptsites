import {type Currency,type FinanceState} from './finance.ts';
import {budgetReports} from './budget.ts';import {goalReport,reserveTargetReport} from './goals.ts';
export interface TransferReportingEffect {id:string;type:'budget'|'goal';name:string;currency:Currency;figures:{label:string;before:number|null;after:number|null}[];notices:string[];}
/** Compare the entire proposed workspace once per report, so cross-period effects combine exactly. */
export function transferReportingEffects(state:FinanceState,next:FinanceState,changes:{accountId:string;date:string}[],relatedAccountIds:string[],asOf:string):TransferReportingEffect[]{
 const effects:TransferReportingEffect[]=[],related=new Set(relatedAccountIds),earliest=new Map<string,string>();for(const c of changes)if(!earliest.has(c.accountId)||earliest.get(c.accountId)!>c.date)earliest.set(c.accountId,c.date);

    for(const book of state.budgetBooks){const dates=book.accountMode==='selected'?book.accountIds.flatMap(id=>earliest.has(id)?[earliest.get(id)!]:[]):[...earliest.values()],first=dates.sort()[0];if(!first||!state.budgetPeriods.some(p=>p.bookId===book.id&&p.endDate>=first))continue;
      const before=budgetReports(state,book,asOf),after=budgetReports(next,book,asOf);
      for(const [id,a] of before){const b=after.get(id)!;const figures=[['Actual spending',a.actualSpending,b.actualSpending],['Available in period',a.available,b.available],['Incoming rollover',a.totalCarry,b.totalCarry],['Uncategorized spending',a.uncategorized,b.uncategorized]] as const;if(figures.some(([,x,y])=>x!==y)||a.actualsComplete!==b.actualsComplete||a.carryComplete!==b.carryComplete)effects.push({id,type:'budget',name:`${book.name} · ${a.period.startDate} to ${a.period.endDate}`,currency:a.period.currency,figures:figures.map(([label,x,y])=>({label,before:x,after:y})),notices:[...(!a.actualsComplete||!b.actualsComplete?['Some spending has incomplete conversion history.']:[]),...(!a.carryComplete||!b.carryComplete?['Some rollover history is incomplete.']:[])]});}
    }
    const linkedGoals=new Set(state.goalAccounts.filter(l=>related.has(l.accountId)).map(l=>l.goalId));
    for(const g of state.goals){if(!linkedGoals.has(g.id)&&g.targetMode!=='months_of_expenses')continue;const a=goalReport(state,g,asOf),b=goalReport(next,g,asOf),figures:{label:string;before:number|null;after:number|null}[]=[{label:'Current backing',before:a.current,after:b.current},{label:'Progress including recorded usage',before:a.progress,after:b.progress},{label:'Saved target',before:g.targetAmount,after:g.targetAmount}];const notices=['Saved goals and contribution checkpoints are unchanged.'];
      if(g.targetMode==='months_of_expenses'&&g.targetMonths){const x=reserveTargetReport(state,g.currency,g.targetMonths,asOf),y=reserveTargetReport(next,g.currency,g.targetMonths,asOf);figures.push({label:'Expense-derived target proposal',before:x.amount,after:y.amount});notices.push('Refresh an expense-derived target separately after reviewing its proposal.');if(x.missing.length||y.missing.length||x.rangeError||y.rangeError)notices.push('The target proposal has missing conversion history or exceeds the supported range.');}
      if(a.incomplete||b.incomplete)notices.push('Some goal backing or conversion history is incomplete.');effects.push({id:g.id,type:'goal',name:g.name,currency:g.currency,figures,notices});
    }
 return effects;
}
