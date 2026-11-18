import {sumMinorUnits,type Currency,type FinanceState} from './finance.ts';
import {addDays} from './recurring.ts';
import {createPaycheckPlan,type PaycheckArrival} from './paycheck.ts';
import type {BillRow,BillTotal} from './bills-workspace.ts';
export interface BillPayPeriod {startsOn:string;endsOn:string;nextPaydayOn:string;bridge:boolean;incomeSources:string[];arrivals:PaycheckArrival[];income:BillTotal;}
export interface BillPayPeriodMarker {beforeOccurrenceId:string;period:BillPayPeriod;expected:BillTotal;countedThrough:string;extendsBeyondHorizon:boolean;continued:boolean;}
export interface BillPayPeriodReport {periods:BillPayPeriod[];markers:BillPayPeriodMarker[];issue:string|null;}
function total(values:(number|null)[]):BillTotal{const missing=values.filter(n=>n===null).length;let known:number|null=null,range=false;try{known=sumMinorUnits(values.filter((n):n is number=>n!==null));}catch{range=true;}return {total:missing||range?null:known,known,missing,range,count:values.length};}
/** Source markers sum full expected bills, including paid/partial cycles, rather than the remaining plan shares. */
export function billPayPeriodMarkers(rows:BillRow[],periods:BillPayPeriod[],counted:BillRow[],horizon:string):BillPayPeriodMarker[]{
 const seen=new Set<number>(),totals=periods.map(p=>total(counted.filter(r=>r.dueOn>=p.startsOn&&r.dueOn<=p.endsOn).map(r=>r.converted.expected)));
 return rows.flatMap(row=>{const index=periods.findIndex(p=>row.dueOn>=p.startsOn&&row.dueOn<=p.endsOn);if(index<0||seen.has(index))return [];seen.add(index);const period=periods[index];return [{beforeOccurrenceId:row.occurrence.id,period,expected:totals[index],countedThrough:period.endsOn<horizon?period.endsOn:horizon,extendsBeyondHorizon:period.endsOn>horizon,continued:false}];});
}
export function createBillPayPeriods(state:FinanceState,{asOf,currency,monthEnd,horizon,rows,counted}:{asOf:string;currency:Currency;monthEnd:string;horizon:string;rows:BillRow[];counted:BillRow[]}):BillPayPeriodReport{
 if(!state.recurringEntries.some(e=>e.billType==='income'&&e.status==='active'&&e.manual===1))return {periods:[],markers:[],issue:null};
 try{const plan=createPaycheckPlan(state,{asOf,currency,periodsLimit:6}),overlapping=plan.periods.filter(p=>p.startsOn<=monthEnd&&p.endsOn>=asOf);if(overlapping.length<=1)return {periods:[],markers:[],issue:null};
 const periods=overlapping.map(p=>({startsOn:p.startsOn,endsOn:p.endsOn,nextPaydayOn:addDays(p.endsOn,1),bridge:p.arrivals.length===0,incomeSources:p.incomeSources,arrivals:p.arrivals,income:total(p.arrivals.map(a=>a.conversion?.amount??null))}));return {periods,markers:billPayPeriodMarkers(rows,periods,counted,horizon),issue:null};}
 catch(error){return {periods:[],markers:[],issue:error instanceof Error?error.message:'Pay periods could not be calculated.'};}
}
/** Repeat the containing marker on a later page, with complete period totals and an explicit continuation label. */
export function billPayPeriodPage(report:BillPayPeriodReport,rows:BillRow[]):BillPayPeriodMarker[]{const seen=new Set<string>();return rows.flatMap(row=>{const marker=report.markers.find(m=>row.dueOn>=m.period.startsOn&&row.dueOn<=m.period.endsOn);if(!marker||seen.has(marker.period.startsOn))return [];seen.add(marker.period.startsOn);return [{...marker,beforeOccurrenceId:row.occurrence.id,continued:marker.beforeOccurrenceId!==row.occurrence.id}];});}
