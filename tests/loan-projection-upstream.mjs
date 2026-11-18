import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {loanTermsSchema} from '../lib/loan-schema.ts';
import {loanPayoff} from '../lib/loan-projection.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout path for original Ruby payoff projection comparison.');
const cases=[];
for(const dayCount of ['thirty_360','actual_365','actual_actual'])for(const rateType of ['fixed','arm'])for(const frequency of ['monthly','weekly','fortnightly'])for(const asOf of ['2025-12-15','2026-01-31','2026-02-28'])for(const fraction of [2,8,18])for(const extraAmount of [0,12345]){
 const terms=loanTermsSchema.parse({initialBalance:123456789,startDate:'2024-01-31',termMonths:60,annualRate:'6.25',rateType,dayCount,rateChanges:[{date:'2025-07-15',rate:'9.125'},{date:'2026-06-01',rate:'0'}]});
 cases.push({terms,principal:Number(BigInt(terms.initialBalance)*BigInt(fraction)/10n),options:{asOf,extraAmount,frequency}});
}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';
class Object
 def present?; !nil? && self != false && (!respond_to?(:empty?) || !empty?); end
end
class Money
 attr_reader :amount,:currency
 def initialize(amount,currency);@amount=BigDecimal(amount.to_s);@currency=currency;end
 def +(other);Money.new(amount+other.amount,currency);end
 def -(other);Money.new(amount-other.amount,currency);end
 class Currency
  def initialize(currency);end
  def default_precision;0;end
 end
end
class Loan;end
root=ARGV.fetch(0)
%w[amortization_math simulation_result simulator amortization_schedule rate_resolver payoff_projection].each { |file| require File.join(root,'app/models/loan',file+'.rb') }
MockLoan=Struct.new(:account,:amortization_schedule,:interest_rate,:day_count_convention,:rate_type,:variable_rates) do
 def variable_rate_type?;rate_type!='fixed';end
end
rows=JSON.parse(STDIN.read).map do |c|
 t=c.fetch('terms');o=c.fetch('options');origin=Date.iso8601(t['startDate']);changes=t['rateChanges'].map { |r| [Date.iso8601(r['date']),BigDecimal(r['rate'])] }.sort_by(&:first)
 loan=MockLoan.new(Struct.new(:balance,:currency).new(c['principal'],'JPY'),nil,BigDecimal(t['annualRate']),t['dayCount'],t['rateType'],changes)
 loan.amortization_schedule=Loan::AmortizationSchedule.new(principal:t['initialBalance'],annual_rate:t['annualRate'],term_months:t['termMonths'],start_date:origin,currency:'JPY',rate_resolver:(Loan::RateResolver.for(loan) if loan.variable_rate_type?),day_count_convention:t['dayCount'])
 p=Loan::PayoffProjection.new(loan,as_of:Date.iso8601(o['asOf']),extra:o['extraAmount'],extra_frequency:o['frequency'])
 {payments:p.payments.map { |r| [r[:payment_number],r[:payment_date].iso8601,r[:beginning_balance].to_i,r[:payment_amount].to_i,r[:principal_payment].to_i,r[:interest_payment].to_i,r[:ending_balance].to_i] },converged:p.converged?,payoff:p.payoff_date&.iso8601,interest:p.total_interest.amount.to_i,balloon:p.balloon_amount.amount.to_i,cost:p.total_cost&.amount&.to_i,months:p.months_saved,interest_saved:p.interest_saved.amount.to_i}
end
STDOUT.write(JSON.generate(rows))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:25_000_000}));let rows=0;
cases.forEach((c,i)=>{
 const p=loanPayoff(c.terms,c.principal,c.options),actual={payments:p.payments.map(r=>[r.number,r.date,r.openingBalance,r.payment,r.principal,r.interest,r.endingBalance]),converged:p.converged,payoff:p.payoffDate,interest:p.totalInterest,balloon:p.balloonAmount,cost:p.totalCost,months:p.monthsSavedAgainstContract,interest_saved:p.interestSavedAgainstContract};
 assert.deepEqual(actual,expected[i],`Original Ruby payoff parity case ${i}: ${JSON.stringify(c)}`);rows+=p.payments.length;
});
console.log(`Matched ${rows} projected payment rows and complete payoff/balloon/interest totals across ${cases.length} cases against Sure's original PayoffProjection: fixed/variable, ahead/behind, all day counts and monthly/weekly/fortnightly extras.`);
