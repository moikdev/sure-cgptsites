import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {createBillsOverview} from '../lib/bills-workspace.ts';import {matcherEntry,matcherOccurrence,matcherState} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout.');
const cases=[];
for(const asOf of ['2026-01-01','2026-01-15','2026-01-30','2026-02-27'])for(const grace of [0,3,7])for(const partial of [0,2500,10000,12000])for(const parked of [false,true])for(const snooze of [false,true]){
 const s=matcherState();s.recurringEntries=[];s.recurringOccurrences=[];s.recurringAllocations=[];s.transactions=[];
 for(const [i,date] of ['2025-12-01','2026-01-02','2026-01-15','2026-01-31','2026-02-01','2026-02-03','2026-02-28','2026-05-30'].entries()){
  const id='s'+(i>=4&&i<=6?'repeat':i),entry=s.recurringEntries.find(e=>e.id===id)??matcherEntry({id,name:id,anchorDate:date,startsOn:date,expectedDayOfMonth:Number(date.slice(8)),endMode:'after_count',endAfterCount:1,overdueGraceDays:grace,status:parked&&i===0?'inactive':'active',autopay:i%2});if(!s.recurringEntries.includes(entry))s.recurringEntries.push(entry);
  const status=i===2?'paid':i===3?'skipped':'scheduled',o=matcherOccurrence({id:'o'+i,recurringEntryId:id,originalDueOn:date,dueOn:date,status,snoozedUntil:snooze&&i===1?'2026-02-02':null});s.recurringOccurrences.push(o);
  if(partial)s.recurringAllocations.push({id:'p'+i,ownerId:'one',occurrenceId:o.id,transactionId:null,splitLineId:null,amount:partial,currency:'USD',sourceAmount:null,sourceCurrency:null,state:'confirmed',source:'user_created',paidOn:'2026-01-01'});
 }
 cases.push({asOf,state:s});
}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal'
class Array;def index_by;to_h { |v| [yield(v),v] };end;end
class Data;def self.define(*members,&block);Struct.new(*members,keyword_init:true,&block);end;end unless defined?(Data)
class Date
 class << self;attr_accessor :now;def current;now;end;end
 def beginning_of_month;Date.new(year,month,1);end
 def end_of_month;Date.new(year,month,-1);end
end
class ApplicationController;def self.before_action(*);end;def self.helper_method(*);end;end
module RecurringFeatureGuardable;end
class ApplicationRecord;def self.method_missing(*);end;end
module Monetizable;end
require File.join(ARGV[0],'app/models/recurring_occurrence.rb')
require File.join(ARGV[0],'app/controllers/bills_controller.rb')
class Money
 class ConversionError<StandardError;end
 attr_reader :value
 def initialize(value,currency);@value=value;end
 def exchange_to(*);self;end
 def +(other);Money.new(value+other.value,'USD');end
end
Series=Struct.new(:id,:status,:autopay,:notify_days_before,:overdue_grace_days) do
 def active?;status=='active';end
 def autopay?;autopay==1;end
end
class RecurringOccurrence
 attr_accessor :id,:recurring_transaction,:due_on,:snoozed_until,:status,:currency,:expected
 def recurring_transaction_id;recurring_transaction.id;end
 def scheduled?;status=='scheduled';end
 def paid?;status=='paid';end
 def resolved_expected_amount;expected;end
end
class EmptyQuery<Array
 def includes(*);self;end;def order(*);self;end;def load;self;end
end
module Current;class << self;attr_accessor :family;end;end
results=JSON.parse(STDIN.read).map do |c|
 Date.now=Date.parse(c['asOf']);s=c['state'];series=s['recurringEntries'].to_h { |e| [e['id'],Series.new(e['id'],e['status'],e['autopay'],e['notifyDaysBefore'],e['overdueGraceDays'])] }
 rows=s['recurringOccurrences'].map do |o|
  row=RecurringOccurrence.new;row.id=o['id'];row.recurring_transaction=series[o['recurringEntryId']];row.due_on=Date.parse(o['dueOn']);row.snoozed_until=o['snoozedUntil']&&Date.parse(o['snoozedUntil']);row.status=o['status'];row.currency='USD';row.expected=10000;row.cached_confirmed_allocated=s['recurringAllocations'].select { |a| a['occurrenceId']==row.id&&a['state']=='confirmed' }.sum { |a| a['amount'] };row
 end
 Current.family=Struct.new(:id,:recurring_occurrences,:currency).new('family',rows,'USD')
 controller=BillsController.new
 controller.define_singleton_method(:params) { {} }
 controller.define_singleton_method(:payable_occurrences) { rows.select { |o| o.due_on<=Date.current+90&&(o.scheduled?||o.effective_due_on>=Date.current.beginning_of_month) } }
 controller.define_singleton_method(:preload_allocation_sums) { |_| }
 controller.define_singleton_method(:month_pay_periods) { |*| [] }
 controller.define_singleton_method(:detected_awaiting_review) { [] }
 controller.define_singleton_method(:accessible_suggested_series) { EmptyQuery.new }
 controller.define_singleton_method(:suggested_allocations) { |_| [] }
 controller.define_singleton_method(:collect_notices) { [] }
 Current.family.define_singleton_method(:entries) { Struct.new(:stub).new(nil).tap { |q| q.define_singleton_method(:where) { |*| self };q.define_singleton_method(:exists?) { false } } }
 controller.index
 get=->(name) {controller.instance_variable_get('@'+name)}
 {sections:{overdue:get.call('overdue').map(&:id),month:get.call('month_rows').map(&:id),later:get.call('later').map(&:id),dormant:get.call('dormant').map(&:id)},nextUp:get.call('next_up').map(&:id),totals:%w[remaining_this_month paid_this_month_total due_next_seven past_due_total].map { |k| get.call(k)&.value||0 },owedCount:get.call('owed_count'),needsActionCount:get.call('needs_action_count'),monthBillCount:get.call('month_bill_count')}
end
STDOUT.write(JSON.generate(results))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:12_000_000}));
cases.forEach(({state,asOf},i)=>{const r=createBillsOverview(state,{asOf,currency:'USD'}),actual={sections:Object.fromEntries(Object.entries(r.sections).map(([key,rows])=>[key,rows.map(r=>r.occurrence.id)])),nextUp:r.nextUp.map(r=>r.occurrence.id),totals:[r.totals.remaining.total,r.totals.paid.total,r.totals.nextSeven.total,r.totals.pastDue.total],owedCount:r.owedCount,needsActionCount:r.needsActionCount,monthBillCount:r.monthBillCount};assert.deepEqual(actual,expected[i],`Original BillsController / RecurringOccurrence case ${i}`);});
console.log(`Matched ${cases.length} bills overview cases against Sure's original BillsController#index, compute_kpis and RecurringOccurrence date/payment methods: late partials, grace, snoozes, parked history, paid due-month totals, rolling seven-day window and one-per-series later/next-up.`);
