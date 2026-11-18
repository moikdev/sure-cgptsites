import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {loanTermsSchema} from '../lib/loan-schema.ts';import {loanSchedule} from '../lib/loans.ts';import {replayLoanPrincipal} from '../lib/loan-principal.ts';import {emptyState} from '../lib/finance.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout.');const cases=[],at=(date,n)=>new Date(Date.parse(date)+n*86400000).toISOString().slice(0,10);
for(const currency of ['USD','JPY','KWD'])for(const startDate of ['2024-01-01','2023-12-31'])for(const dayCount of ['thirty_360','actual_365','actual_actual'])for(const principalOnlyTransfers of [false,true])for(const insuranceType of [null,'level_term','decreasing_life'])for(const rateType of ['fixed','arm'])for(const pattern of ['full','partial','late2','late6','missed','refund','valuation','same_day','credit']){
 const scale=currency==='JPY'?1:currency==='KWD'?1000:100,terms=loanTermsSchema.parse({initialBalance:12000*scale,startDate,termMonths:12,annualRate:'12',rateType,rateChanges:[{date:at(startDate,50),rate:'5'},{date:at(startDate,120),rate:'0'}],dayCount,insuranceRate:insuranceType?'1.2':null,insuranceType,principalOnlyTransfers}),schedule=loanSchedule(terms),account={id:'loan',ownerId:'one',name:'Manual loan',currency,type:'loan',openingBalance:-terms.initialBalance,openingDate:startDate,archived:0,loanTerms:terms},state={...structuredClone(emptyState),accounts:[account],transactions:[],valuations:[]};let seq=0;
 const add=(date,amount,linked=false)=>{const id='t'+seq++,transferId=linked?'pair'+id:null;state.transactions.push({id,ownerId:'one',accountId:'loan',date,name:'Payment',amount,categoryId:null,merchantId:null,tagIds:[],kind:linked?'funds_movement':'standard',transferId,notes:'',importKey:null});if(linked)state.transactions.push({...state.transactions.at(-1),id:'other'+id,accountId:'cash',amount:-amount});};
 const p=schedule.payments;
 if(pattern==='full'||pattern.startsWith('late'))for(const row of p.slice(0,5))add(at(row.date,pattern==='late2'?2:pattern==='late6'?6:0),row.total,principalOnlyTransfers);
 if(pattern==='partial'){add(p[0].date,50*scale);add(at(p[1].date,1),400*scale);add(at(p[1].date,3),1000*scale,true);add(p[2].date,p[2].total);}
 if(pattern==='missed'){add(at(p[2].date,14),p[2].total);add(p[3].date,p[3].total);}
 if(pattern==='refund'){add(p[0].date,p[0].total);add(at(p[0].date,14),-500*scale,true);add(p[1].date,p[1].total);}
 if(pattern==='valuation'){add(p[0].date,50*scale);state.valuations.push({id:'v',ownerId:'one',accountId:'loan',date:at(p[0].date,14),amount:-11000*scale,name:'End of day reconciliation',kind:'reconciliation'});add(at(p[1].date,1),p[1].total);add(p[2].date,p[2].total);}
 if(pattern==='same_day'){add(p[0].date,-100*scale);add(p[0].date,Math.floor(p[0].total/2),true);add(p[0].date,p[0].total-Math.floor(p[0].total/2));state.valuations.push({id:'v',ownerId:'one',accountId:'loan',date:p[0].date,amount:-10000*scale,name:'Reconciled',kind:'reconciliation'});add(p[1].date,p[1].total);}
 if(pattern==='credit'){add(p[0].date,20000*scale,true);add(at(p[1].date,2),100*scale);add(p[2].date,-10000*scale);add(p[3].date,1000*scale);}
 cases.push({account,state,scale,pattern,asOf:at(p[5].date,10)});
}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'bigdecimal/util';require 'set'
class Object;def present?;!nil?&&self!=false&&(!respond_to?(:empty?)||!empty?);end;def presence;present? ? self : nil;end;end
class Date;def next_month;self>>1;end;end
class Money
 attr_reader :amount,:currency
 def initialize(amount,currency);@amount=BigDecimal(amount.to_s);@currency=currency;end
 class Currency
  def initialize(c);@c=c;end
  def default_precision;@c=='JPY' ? 0 : @c=='KWD' ? 3 : 2;end
 end
end
class Loan;DEFAULT_DAY_COUNT_CONVENTION='thirty_360';end
%w[amortization_math simulation_result simulator rate_resolver amortization_schedule insurance principal_payments].each { |name| require File.join(ARGV[0],'app/models/loan',name+'.rb') }
Account=Struct.new(:currency,:opening_anchor_balance,:opening_anchor_date) do;def manual?;true;end;def has_opening_anchor?;true;end;end
class TestLoan
 attr_reader :account,:t,:scale
 def initialize(a,t,s);@account=a;@t=t;@scale=s;end
 def amortizable?;true;end;def initial_balance;BigDecimal(t['initialBalance'].to_s)/scale;end;def original_balance;Money.new(initial_balance,account.currency);end;def origination_date;Date.parse(t['startDate']);end;def interest_rate;BigDecimal(t['annualRate']);end;def term_months;t['termMonths'];end;def day_count_convention;t['dayCount'];end;def principal_only_transfers?;t['principalOnlyTransfers'];end;def variable_rate_type?;t['rateType']!='fixed';end;def variable_rates;t['rateChanges'].map { |r| [Date.parse(r['date']),BigDecimal(r['rate'])] }.sort_by(&:first);end;def amortization_schedule;@schedule||=Loan::AmortizationSchedule.for(self);end;def insurance_rate;t['insuranceRate']&&BigDecimal(t['insuranceRate']);end;def insurance_rate_type;t['insuranceType'];end;def insurance;@insurance||=Loan::Insurance.for(self);end
end
Entry=Struct.new(:id,:entryable_id,:date,:amount,:type) do;def transaction?;type=='t';end;def valuation?;type=='v';end;end
class Transfer
 class << self;attr_accessor :ids;def where(*);self;end;def pluck(*);ids.map { |i| [i,i] };end;end
end
output=JSON.parse(STDIN.read).map do |c|
 a=c['account'];scale=c['scale'];account=Account.new(a['currency'],BigDecimal((-a['openingBalance']).to_s)/scale,Date.parse(a['openingDate']));loan=TestLoan.new(account,a['loanTerms'],scale);state=c['state'];entries=state['transactions'].select { |t| t['accountId']==a['id']&&t['date']<=c['asOf'] }.map { |t| Entry.new(t['id'],t['id'],Date.parse(t['date']),-BigDecimal(t['amount'].to_s)/scale,'t') };entries+=state['valuations'].map { |v| Entry.new(v['id'],v['id'],Date.parse(v['date']),-BigDecimal(v['amount'].to_s)/scale,'v') };Transfer.ids=state['transactions'].select { |t| t['transferId'] }.map { |t| t['id'] }
 replay=Loan::PrincipalPayments.for(loan,entries:entries);raise 'Ineligible oracle loan' unless replay
 replay.changes.map { |date,change| {date:date.iso8601,principalPaid:(change.principal_paid*scale).round.to_i,principalAdded:(change.principal_added*scale).round.to_i,interestPaid:(change.interest_paid*scale).round.to_i} }
end
STDOUT.write(JSON.generate(output))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:30_000_000}));let days=0;cases.forEach((c,i)=>{const replay=replayLoanPrincipal(c.account,c.state,c.asOf);assert.deepEqual(replay.changes.map(({date,principalPaid,principalAdded,interestPaid})=>({date,principalPaid,principalAdded,interestPaid})),expected[i],'Original PrincipalPayments '+i+' '+JSON.stringify({currency:c.account.currency,terms:c.account.loanTerms,pattern:c.pattern}));let balance=c.account.openingBalance;for(const row of expected[i]){balance+=row.principalPaid-row.principalAdded;const v=c.state.valuations.find(v=>v.date===row.date);if(v)balance=v.amount;}assert.equal(replay.balance,balance,'Original principal balance '+i);days+=replay.changes.length;});console.log(`Matched ${cases.length} original PrincipalPayments cases (${days} payment/reset days): native precision, all day counts, fixed/variable rates, linked principal-only/full payments, insurance, partial/missed/early/late/grace payments, refunds, same-day/mid-period valuation resets and credit overpayments.`);
