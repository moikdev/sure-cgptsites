import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {collectRecurringPatterns,planRecurringDetection,recurringDetectionSources,classifyRecurringPattern,circularDetectionDay,detectionDaysAgree,detectionScheduleMatches} from '../lib/recurring-detection.ts';
import {matcherState,matcherTransaction,matcherEntry} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout.');const cases=[];
for(const currency of ['USD','JPY','KWD'])for(const accountType of ['checking','credit','investment'])for(const days of [[15,15,15],[14,15,16],[5,10,15],[28,28,30]])for(const amounts of [[1000,1000,1000],[1000,1075,1076],[99,100,100],[1000,1060,1120],[-1000,-3000,-1200]])for(const name of ['Netflix','Water autopay','Maxwell Plumbing']){
 const s=matcherState();s.accounts[0].currency=currency;s.accounts[0].type=accountType;s.recurringEntries=[];s.recurringOccurrences=[];s.transactions=amounts.map((amount,i)=>matcherTransaction({id:'t'+i,amount:-amount,name,date:`2026-0${i+1}-${days[i]}`}));cases.push({asOf:'2026-03-31',state:s});
}
const classifierCases=[];for(const name of ['Netflix','NETFLIX ACH','Klarna rent','Maxwell Plumbing','gastropub','UTILITIES AUTODRAFT','Auto pay insurance','Apple.com/bill','AppleXcom/bill','éNetflix','Netflixé','Microsoft 365','grok','t-mobile','web pmt','x.ai','xXai'])for(const currency of ['USD','JPY','KWD'])for(const type of ['checking','credit'])for(const amount of [100,15000,15001])classifierCases.push({name,currency,type,amount});
const scheduleCases=[];for(const frequency of ['weekly','monthly','yearly'])for(const interval of [1,2,3])for(const weekendAdjust of ['none','before','after','skip'])for(const endMode of ['never','on_date','after_count'])for(const date of ['2025-12-15','2026-01-02','2026-01-03','2026-01-05','2026-02-15','2026-03-15','2026-03-17']){const entry=matcherEntry({anchorDate:'2026-01-03',startsOn:'2026-01-03',weekendAdjust,endMode,endOn:'2026-03-01',endAfterCount:2,rules:[{frequency,interval,weekday:frequency==='weekly'?6:null,dayOfMonth:frequency==='weekly'?null:15,weekdayOrdinal:null,monthOfYear:frequency==='yearly'?1:null}]});scheduleCases.push({entry,date});}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'bigdecimal/util'
class Object;def present?;!nil?&&self!=false&&(!respond_to?(:empty?)||!empty?);end;def blank?;!present?;end;def presence;present? ? self : nil;end;def try(key);respond_to?(key) ? public_send(key) : nil;end;end
class Struct;def with(**attrs);self.class.new(**to_h.merge(attrs));end;end
class Data;def self.define(*members,&block);Struct.new(*members,keyword_init:true,&block);end;end unless defined?(Data)
Span=Struct.new(:n,:months) do;def ago;months ? Date.current << n : Date.current-n;end;end
class Integer;def months;Span.new(self,true);end;def days;Span.new(self,false);end;end
class Date
 class << self;attr_accessor :now;def current;now;end;end
 def to_date;self;end;def next_month;self>>1;end;def end_of_month;Date.new(year,month,-1);end
end
class RecurrenceRule;LAST=-1;end
class Transaction
 TRANSFER_KINDS=%w[funds_movement cc_payment loan_payment investment_contribution]
 attr_accessor :merchant_id,:category_id,:kind
end
Entry=Struct.new(:id,:name,:amount,:date,:currency,:account_id,:entryable,:account_type)
Account=Struct.new(:accountable_type)
Series=Struct.new(:merchant_id,:name,:currency,:account_id,:destination_account_id,:amount,:bill_type) do;def matcher_name;name;end;end
class Query
 def initialize(rows);@rows=rows;end
 def joins(*);self;end;def includes(*);self;end;def to_a;@rows;end
 def where(*args,**kwargs)
  return self if args.empty?&&kwargs.empty?
  Query.new(@rows.select do |row|
   if args.empty?
    kwargs.all? { |key,value| key==:entryable_type||row.public_send(key)==value }
   elsif args[0].include?('accountable_type')
    !args[1].include?(row.account_type)
   elsif args[0].include?('amount <')
    row.amount<0
   else
    row.date>=args[1]
   end
  end)
 end
 def not(**kwargs);Query.new(@rows.reject { |row| Array(kwargs.values.first).include?(row.entryable.kind) });end
end
require File.join(ARGV[0],'app/models/recurring_transaction/schedule.rb')
require File.join(ARGV[0],'app/models/recurring_transaction/classifier.rb')
require File.join(ARGV[0],'app/models/recurring_transaction/identifier.rb')
def schedule(e)
 rules=e['rules'].map { |r| RecurringTransaction::Schedule::Rule.new(frequency:r['frequency'],interval:r['interval'],day_of_month:r['dayOfMonth'],weekday:r['weekday'],weekday_ordinal:r['weekdayOrdinal'],month_of_year:r['monthOfYear']) }
 RecurringTransaction::Schedule.new(expected_day_of_month:e['expectedDayOfMonth'],rules:rules,anchor_date:Date.parse(e['anchorDate']),weekend_adjust:e['weekendAdjust'],end_mode:e['endMode'],end_on:e['endOn']&&Date.parse(e['endOn']),end_after_count:e['endAfterCount'])
end
input=JSON.parse(STDIN.read)
patterns=input['cases'].map do |c|
 Date.now=Date.parse(c['asOf']);scale=10**c['precision'];entries=c['sources'].map do |s|
  transaction=Transaction.new;transaction.merchant_id=s['merchantId'];transaction.category_id=s['categoryId'];transaction.kind=s['kind'];Entry.new(s['id'],s['name'],-BigDecimal(s['amount'].to_s)/scale,Date.parse(s['date']),s['currency'],s['accountId'],transaction,c['type'])
 end
 family=Struct.new(:entries,:recurring_transactions).new(Query.new(entries),Query.new([]));identifier=RecurringTransaction::Identifier.new(family)
 normalize=->(p) { {amount:-(p[:amount]*scale).round(0).to_i,minimum:([p[:expected_amount_min],p[:expected_amount_max]].compact.map(&:abs).min*scale).round(0).to_i,maximum:([p[:expected_amount_min],p[:expected_amount_max]].compact.map(&:abs).max*scale).round(0).to_i,average:(p[:expected_amount_avg].abs*scale).round(0).to_i,day:p[:expected_day_of_month],count:p[:occurrence_count],date:p[:last_occurrence_date].iso8601,name:p[:name]} }
 auto=identifier.send(:collect_patterns,min_occurrences:3).map(&normalize)
 bills=identifier.candidate_patterns.map(&normalize)
 income=identifier.income_source_candidates.map { |p| {amount:-(p[:amount]*scale).round(0).to_i,average:(p[:expected_amount_avg].abs*scale).round(0).to_i,count:p[:occurrence_count],date:p[:last_occurrence_date].iso8601,name:p[:name]} }
 {auto:auto,bills:bills,income:income}
end
classifications=input['classifications'].map do |c|
 scale=10**c['precision'];t=Transaction.new;e=Entry.new('one',c['name'],BigDecimal(c['amount'].to_s)/scale,Date.current,c['currency'],'cash',t,nil);r=RecurringTransaction::Classifier.classify(name:c['name'],entries:[e,e],account:Account.new(c['type']=='credit' ? 'CreditCard' : 'Depository'));{billType:r.bill_type,autopay:r.autopay ? 1 : 0}
end
schedule_results=input['schedules'].map { |c| schedule(c['entry']).matches_day?(Date.parse(c['date'])) }
STDOUT.write(JSON.generate({patterns:patterns,classifications:classifications,schedules:schedule_results}))
`;
const precision=c=>c==='JPY'?0:c==='KWD'?3:2,type=t=>({investment:'Investment',credit:'CreditCard',checking:'Depository'})[t];
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify({cases:cases.map(c=>({asOf:c.asOf,sources:recurringDetectionSources(c.state),precision:precision(c.state.accounts[0].currency),type:type(c.state.accounts[0].type)})),classifications:classifierCases.map(c=>({...c,precision:precision(c.currency)})),schedules:scheduleCases}),encoding:'utf8',maxBuffer:20_000_000}));
const normalize=p=>({amount:p.amount,minimum:p.minimum,maximum:p.maximum,average:p.average,day:p.expectedDay,count:p.count,date:p.lastDate,name:p.name});
cases.forEach(({state,asOf},i)=>{assert.deepEqual(collectRecurringPatterns(state,asOf).map(normalize),expected.patterns[i].auto,'Original collector '+i);assert.deepEqual(planRecurringDetection(state,{asOf,kind:'bills'}).rows.map(r=>normalize(r.pattern)),expected.patterns[i].bills,'Original bill candidates '+i);assert.deepEqual(planRecurringDetection(state,{asOf,kind:'income'}).rows.map(({pattern:p})=>({amount:p.amount,average:p.average,count:p.count,date:p.lastDate,name:p.name})),expected.patterns[i].income,'Original income sources '+i);});
classifierCases.forEach((c,i)=>{const source={id:'one',transactionId:'one',splitLineId:null,name:c.name,date:'2026-01-01',amount:-c.amount,currency:c.currency,accountId:'cash',merchantId:null,categoryId:null,kind:'standard',excluded:0},result=classifyRecurringPattern(c.name,[source,source],c.type);assert.deepEqual({billType:result.billType,autopay:result.autopay},expected.classifications[i],'Original classifier '+JSON.stringify(c));});
scheduleCases.forEach((c,i)=>assert.equal(detectionScheduleMatches(c.entry,c.date),expected.schedules[i],'Original variance cadence '+JSON.stringify(c)));
console.log(`Matched ${cases.length} original Identifier collector/candidate/income cases, ${classifierCases.length} original Classifier cases and ${scheduleCases.length} original Schedule#matches_day? cases, covering exact clustering, minimum amounts, day consistency, native precision, keyword boundaries and cadence/end/weekend behavior.`);
