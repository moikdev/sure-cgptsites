// Port of Portfolio::Xirr from Sure d194118. Iteration deliberately uses
// floating point for fractional powers; ledger money remains integer minor units.
import {validDate} from './finance.ts';
export interface XirrFlow {readonly date:string;readonly amount:number;}
export type XirrFailure='no_duration'|'no_sign_change'|'convergence';
export class XirrError extends Error {code:XirrFailure;constructor(code:XirrFailure,message:string){super(message);this.code=code;}}
// Neumaier compensation mirrors Ruby Enumerable#sum's cancellation protection.
export function compensatedSum(values:Iterable<number>){let sum=0,correction=0;for(const value of values){const next=sum+value;if(!Number.isFinite(next)||!Number.isFinite(value)||!Number.isFinite(sum)){sum=next;correction=0;continue;}correction+=Math.abs(sum)>=Math.abs(value)?(sum-next)+value:(value-next)+sum;sum=next;}return sum+correction;}
export class Xirr {
 readonly flows:readonly Readonly<XirrFlow>[];readonly daysPerUnit:number;
 private inputDateCount:number;private terms:readonly {units:number;amount:number}[];private residualTolerance:number;private cachedRate:number|undefined;private floor:number|null|undefined;
 constructor(input:readonly XirrFlow[],daysPerUnit=365){
  if(!Number.isFinite(daysPerUnit)||daysPerUnit<=0)throw new Error('daysPerUnit must be a positive, finite number of days.');
  if(input.length>40000)throw new Error('Use at most 40,000 XIRR flows.');
  for(const flow of input)if(!validDate(flow.date)||!Number.isFinite(flow.amount))throw new Error('XIRR needs valid dates and finite amounts.');
  const moves=input.filter(f=>f.amount!==0),groups=new Map<string,number[]>();this.inputDateCount=new Set(moves.map(f=>f.date)).size;
  for(const flow of moves){const group=groups.get(flow.date)??[];group.push(flow.amount);groups.set(flow.date,group);}
  this.flows=Object.freeze([...groups].map(([date,amounts])=>Object.freeze({date,amount:compensatedSum(amounts)})).filter(f=>f.amount!==0).sort((a,b)=>a.date.localeCompare(b.date)));
  if(this.flows.some(f=>!Number.isFinite(f.amount)))throw new Error('Same-day XIRR amounts exceed the finite number range.');
  this.daysPerUnit=daysPerUnit;const first=this.flows[0]?.date;
  this.terms=this.flows.map(f=>({units:(Date.parse(f.date+'T00:00:00Z')-Date.parse(first+'T00:00:00Z'))/86400000/daysPerUnit,amount:f.amount}));
  this.residualTolerance=1e-12*compensatedSum(this.flows.map(f=>Math.abs(f.amount)));
  Object.defineProperty(this,'flows',{writable:false,configurable:false});Object.defineProperty(this,'daysPerUnit',{writable:false,configurable:false});
 }
 get signChanges(){return this.flows.reduce((n,f,i)=>n+(i>0&&Math.sign(f.amount)!==Math.sign(this.flows[i-1].amount)?1:0),0);}
 get ambiguous(){return this.signChanges>1;}
 rate(){
  if(this.cachedRate!==undefined)return this.cachedRate;
  if(this.inputDateCount===1)throw new XirrError('no_duration','Cash flows all fall on one date.');
  if(this.signChanges===0)throw new XirrError('no_sign_change','Cash flows never change sign.');
  const rate=this.newtonRate()??this.bisectionRate();if(rate===null)throw new XirrError('convergence','XIRR did not converge.');
  this.cachedRate=rate;return rate;
 }
 private presentValue(rate:number){return compensatedSum(this.terms.map(t=>t.amount/((1+rate)**t.units)));}
 private derivative(rate:number){return compensatedSum(this.terms.map(t=>t.units===0?0:-t.units*t.amount/((1+rate)**(t.units+1))));}
 private lowEndpoint(){
  if(this.floor!==undefined)return this.floor;
  for(let distance=Number.EPSILON;distance<1;distance*=2){const candidate=-1+distance;if(Number.isFinite(this.presentValue(candidate)))return this.floor=candidate;}
  let gap=0.5;while(gap>Number.EPSILON){gap/=2;const candidate=-gap;if(Number.isFinite(this.presentValue(candidate)))return this.floor=candidate;}
  return this.floor=null;
 }
 private newtonRate(){let rate=0.1;for(let i=0;i<50;i++){
  const value=this.presentValue(rate);if(Math.abs(value)<this.residualTolerance)return rate;
  const derivative=this.derivative(rate);if(derivative===0||!Number.isFinite(derivative))return null;
  const next=rate-value/derivative;if(!Number.isFinite(next)||next<=(this.lowEndpoint()??-1))return null;
  if(Math.abs(next-rate)<1e-9)return Math.abs(this.presentValue(next))<this.residualTolerance?next:null;
  rate=next;
 }return null;}
 private bisect(low:number,high:number){let lowValue=this.presentValue(low);const highValue=this.presentValue(high);if(!Number.isFinite(lowValue)||!Number.isFinite(highValue))return null;
  if(Math.abs(lowValue)<this.residualTolerance)return low;if(Math.abs(highValue)<this.residualTolerance)return high;if(lowValue*highValue>0)return null;
  for(let i=0;i<200;i++){const mid=(low+high)/2,value=this.presentValue(mid);if(Math.abs(value)<this.residualTolerance||Math.abs(high-low)<1e-9)return mid;if(lowValue*value<0)high=mid;else{low=mid;lowValue=value;}}
  return null;
 }
 private bisectionRate(){const low=this.lowEndpoint(),high=1e7;if(low===null)return null;const root=this.bisect(low,high);if(root!==null)return root;
  const ratio=((1+high)/(1+low))**(1/128);let previous=low,previousValue=this.presentValue(previous);
  for(let i=0;i<128;i++){const rate=(1+previous)*ratio-1,value=this.presentValue(rate);if(!Number.isFinite(value))return null;if(previousValue*value<=0){const root=this.bisect(previous,rate);if(root!==null)return root;}previous=rate;previousValue=value;}
  return null;
 }
}
export function xirrResult(flows:readonly XirrFlow[],daysPerUnit=365){const solver=new Xirr(flows,daysPerUnit);try{return {rate:solver.rate(),reason:null,signChanges:solver.signChanges,ambiguous:solver.ambiguous};}catch(error){if(error instanceof XirrError)return {rate:null,reason:error.code,signChanges:solver.signChanges,ambiguous:solver.ambiguous};throw error;}}
