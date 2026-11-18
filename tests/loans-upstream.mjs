import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {loanTermsSchema} from '../lib/loan-schema.ts';
import {loanSchedule} from '../lib/loans.ts';
const root=process.argv[2];
if(!root)throw new Error('Pass an upstream Sure checkout path. This optional parity check loads its original Ruby simulator.');
const cases=[];
for(const dayCount of ['thirty_360','actual_365','actual_actual'])for(const annualRate of ['0','0.001','3.5','12','99.999'])for(const variable of [false,true]){
 const startDate=variable?'2023-12-31':'2024-01-31';
 cases.push(loanTermsSchema.parse({initialBalance:123456789,startDate,termMonths:variable?36:360,annualRate,rateType:variable?'arm':'fixed',dayCount,rateChanges:variable?[{date:'2024-02-15',rate:'7.125'},{date:'2024-10-01',rate:'0'},{date:'2025-03-31',rate:'2.750'}]:[]}));
}
for(const principal of [1,10,123456])cases.push(loanTermsSchema.parse({initialBalance:principal,startDate:'2026-01-01',termMonths:1200,annualRate:'0',rateType:'fixed'}));
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';
class Loan; end
root=ARGV.fetch(0)
%w[amortization_math simulation_result simulator].each { |name| require File.join(root,'app/models/loan',name+'.rb') }
rows=JSON.parse(STDIN.read).map do |t|
 start=Date.iso8601(t.fetch('startDate')); changes=t.fetch('rateChanges').map { |r| [Date.iso8601(r.fetch('date')),BigDecimal(r.fetch('rate'))] }.sort_by(&:first)
 rate=->(date) { t['rateType']=='fixed' ? BigDecimal(t['annualRate']) : (changes.reverse.find { |d,_| d<=date }&.last || BigDecimal(t['annualRate'])) }
 result=Loan::Simulator.new(starting_balance:BigDecimal(t['initialBalance'].to_s),accrual_start_date:start,payment_schedule:(1..t['termMonths']).map { |n| start >> n },accrual_rate_for:rate,currency_precision:0,day_count_convention:t['dayCount']).run
 result.payments.map { |p| [p[:payment_number],p[:payment_date].iso8601,p[:beginning_balance].to_i,p[:payment_amount].to_i,p[:principal_payment].to_i,p[:interest_payment].to_i,p[:ending_balance].to_i] }
end
STDOUT.write(JSON.generate(rows))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:20_000_000}));
let rows=0;
cases.forEach((t,i)=>{
 const actual=loanSchedule(t).payments.map(p=>[p.number,p.date,p.openingBalance,p.payment,p.principal,p.interest,p.endingBalance]);
 assert.deepEqual(actual,expected[i],`Original Ruby simulator parity case ${i}: ${JSON.stringify(t)}`);rows+=actual.length;
});
console.log(`Matched ${rows} scheduled rows across ${cases.length} cases against the original Sure Ruby simulator: fixed/variable rates, cross-year/leap dates, all day counts, rounding and long terms.`);
