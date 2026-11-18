import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {createBillDetail} from '../lib/bill-details.ts';import {matcherState,matcherEntry,matcherOccurrence} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout.');const cases=[];
for(const asOf of ['2026-01-01','2026-02-20','2026-12-31'])for(const currency of ['USD','JPY','KWD'])for(const baseAmount of [10000,10001,12345])for(const frequency of ['weekly','monthly','yearly'])for(const interval of [1,3])for(const split of [false,true]){
 const s=matcherState();s.transactions=[];s.recurringOccurrences=[];s.recurringAllocations=[];s.recurringEntries=[matcherEntry({currency,amount:-baseAmount,endMode:'after_count',endAfterCount:1,rules:[{frequency,interval,weekday:frequency==='weekly'?4:null,dayOfMonth:frequency==='weekly'?null:15,weekdayOrdinal:null,monthOfYear:frequency==='yearly'?1:null}]})];
 for(const [i,date] of ['2024-12-15','2025-03-15','2025-12-15','2026-01-15','2026-02-15','2027-01-15'].entries()){
  const o=matcherOccurrence({id:'o'+i,originalDueOn:date,dueOn:date,status:i===4?'scheduled':i===1?'skipped':'paid',currency,snoozedUntil:i===2?'2026-02-15':null});s.recurringOccurrences.push(o);
  for(const [j,value] of (split?[333,777]:[1100+i]).entries())s.recurringAllocations.push({id:`p${i}-${j}`,ownerId:'one',occurrenceId:o.id,transactionId:null,splitLineId:null,amount:value,currency,sourceAmount:null,sourceCurrency:null,state:i===5&&j===1?'suggested':'confirmed',source:'user_created',paidOn:i===0?null:i===2?'2026-01-02':i===3?'2025-12-01':date});
 }
 cases.push({asOf,precision:currency==='JPY'?0:currency==='KWD'?3:2,state:s});
}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'bigdecimal/util'
class Data;def self.define(*members,&block);Struct.new(*members,keyword_init:true,&block);end;end unless defined?(Data)
class Object;def presence;self;end;end
class Array;def presence;empty? ? nil : self;end;end
MonthSpan=Struct.new(:n) do;def ago;Date.current << n;end;end
class Integer;def months;MonthSpan.new(self);end;end
class Date
 class << self;attr_accessor :now;def current;now;end;end
 def beginning_of_month;Date.new(year,month,1);end
 def beginning_of_year;Date.new(year,1,1);end
 def to_date;self;end
 alias old_plus +
 def +(other);other.is_a?(MonthSpan) ? self >> other.n : old_plus(other);end
end
class ApplicationController;def self.before_action(*);end;def self.helper_method(*);end;end
module RecurringFeatureGuardable;end
class Money
 attr_reader :amount
 def initialize(value,*);@amount=BigDecimal(value.to_s);end
 def *(value);Money.new(amount*value.to_d);end
end
require File.join(ARGV[0],'app/models/recurring_transaction/schedule.rb')
require File.join(ARGV[0],'app/controllers/bills_controller.rb')
Row=Struct.new(:series_id,:occurrence_id,:status,:due_on,:paid_on,:amount,:state,:entry_id,:entry)
class Query
 def initialize(rows,group=nil);@rows=rows;@group=group;end
 def joins(*);self;end;def includes(*);self;end;def order(*);self;end;def first;@rows.first;end
 def where(*args,**kwargs)
  return self if args.empty?&&kwargs.empty?
  Query.new(@rows.select do |row|
   if !args.empty?
    value=args[0].include?('paid_on') ? row.paid_on : row.due_on;value&&value>=args[1]
   else
    kwargs.all? do |key,values|
     values.all? { |field,value| row.public_send(field==:recurring_transaction_id ? :series_id : field)==value }
    end
   end
  end)
 end
 def not(**kwargs);Query.new(@rows.reject { |row| kwargs.all? { |key,value| row.public_send(key)==value } });end
 def group(key);Query.new(@rows,key);end
 def grouped
  @rows.group_by do |row|
   @group==:recurring_occurrence_id ? row.occurrence_id : @group.include?("'month'") ? Date.new(row.due_on.year,row.due_on.month,1) : Date.new(row.due_on.year,1,1)
  end
 end
 def sum(*);@group ? grouped.transform_values { |rows| rows.sum(&:amount) } : @rows.sum(&:amount);end
 def count;grouped.transform_values(&:size);end
end
class RecurringAllocation
 class << self;attr_accessor :rows;def confirmed;Query.new(rows.select { |r| r.state=='confirmed' });end;end
end
module Arel;def self.sql(value);value;end;end
Series=Struct.new(:id,:currency,:monthly_equivalent_amount)
result=JSON.parse(STDIN.read).map do |c|
 Date.now=Date.parse(c['asOf']);s=c['state'];e=s['recurringEntries'][0];scale=10**c['precision'];occ=s['recurringOccurrences'].to_h { |o| [o['id'],o] }
 RecurringAllocation.rows=s['recurringAllocations'].map do |a|
  o=occ[a['occurrenceId']];Row.new(e['id'],o['id'],o['status'],Date.parse(o['dueOn']),a['paidOn']&&Date.parse(a['paidOn']),BigDecimal(a['amount'].to_s)/scale,a['state'],nil,nil)
 end
 rules=e['rules'].map { |r| RecurringTransaction::Schedule::Rule.new(frequency:r['frequency'],interval:r['interval'],day_of_month:r['dayOfMonth'],weekday:r['weekday'],weekday_ordinal:r['weekdayOrdinal'],month_of_year:r['monthOfYear']) }
 schedule=RecurringTransaction::Schedule.new(expected_day_of_month:15,rules:rules,anchor_date:Date.new(2026,1,15));monthly=Money.new(BigDecimal(e['amount'].abs.to_s)/scale)*(schedule.occurrences_per_year/12.0)
 controller=BillsController.new;controller.instance_variable_set('@series',Series.new(e['id'],e['currency'],monthly));a=controller.send(:paid_analytics);controller.send(:load_deep_extras)
 minor=->(money) {(money.amount*scale).round(0).to_i}
 {analytics:a&&{average:minor.call(a[:average]),lowest:minor.call(a[:lowest]),highest:minor.call(a[:highest])},cadence:{monthly:minor.call(monthly),annual:minor.call(monthly*12)},ytd:a&&minor.call(a[:ytd]),months:controller.instance_variable_get('@payment_history').map { |month,total| {month:month.strftime('%Y-%m'),total:(total*scale).round(0).to_i} },years:controller.instance_variable_get('@yearly_metrics').map { |row| {year:row[:year],total:minor.call(row[:total]),average:minor.call(row[:average])} }}
end
STDOUT.write(JSON.generate(result))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:18_000_000}));
cases.forEach(({asOf,state},i)=>{const report=createBillDetail(state,'series',{asOf}),a=report.analytics,actual={analytics:a&&{average:a.average,lowest:a.lowest,highest:a.highest},cadence:report.cadence,ytd:report.ytd,months:report.paymentHistory.map(({month,total})=>({month,total})),years:report.yearlyMetrics.slice(0,4).map(({year,total,average})=>({year,total,average}))};assert.deepEqual(actual,expected[i],`Original bill detail analytics case ${i}`);});
console.log(`Matched ${cases.length} bill-cost cases against Sure's actual BillsController#paid_analytics, load_deep_extras, ytd_paid_total and Schedule#occurrences_per_year: currency precision, settled-cycle versus allocation averages, monthly/yearly attribution, snoozes, partial/skipped/suggested records, future/undated payments and cadence rates.`);
