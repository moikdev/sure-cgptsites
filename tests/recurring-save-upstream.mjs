import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {schedulePhasePairs} from '../lib/recurring.ts';import {generationWindow} from '../lib/recurring-maintenance.ts';import {planRecurringSave} from '../lib/recurring-save.ts';import {matcherState,matcherEntry,matcherOccurrence} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout.');const cases=[];
for(const frequency of ['weekly','monthly','yearly'])for(const interval of [1,2])for(const weekendAdjust of ['none','before','after','skip'])for(const endMode of ['never','on_date','after_count'])for(const manual of [0,1])for(const status of ['active','paused'])for(const asOf of ['2026-03-20','2026-06-15']){
 const s=matcherState();s.transactions=[];s.recurringEntries=[matcherEntry({manual,anchorDate:'2025-12-15',startsOn:'2025-12-15',weekendAdjust,endMode,endOn:'2026-08-31',endAfterCount:8,rules:[{frequency,interval,dayOfMonth:frequency==='weekly'?null:15,weekday:frequency==='weekly'?1:null,weekdayOrdinal:null,monthOfYear:frequency==='yearly'?2:null}]})];const old=s.recurringEntries[0];s.recurringOccurrences=schedulePhasePairs(old,old.anchorDate,'2027-05-31').map((pair,i)=>matcherOccurrence({...pair,id:'o'+i,status:i%7===1?'paid':i%7===2?'skipped':'scheduled',expectedAmount:i%7===3?10000:null}));s.recurringAllocations=s.recurringOccurrences.filter((_,i)=>i%7===3).map(o=>({id:'a'+o.id,ownerId:'one',occurrenceId:o.id,transactionId:null,splitLineId:null,amount:1000,currency:'USD',sourceAmount:null,sourceCurrency:null,state:'suggested',source:'auto_matched',paidOn:null}));const entry={...old,status,rules:old.rules.map(r=>({...r,dayOfMonth:r.dayOfMonth===null?null:16,weekday:r.weekday===null?null:2}))};cases.push({state:s,entry,asOf,window:generationWindow(entry,asOf)});
}
const ruby=String.raw`
require 'json';require 'date';require 'set'
class Object;def present?;!nil?&&self!=false&&(!respond_to?(:empty?)||!empty?);end;def presence;present? ? self : nil;end;end
class Data;def self.define(*members,&block);Struct.new(*members,keyword_init:true,&block);end;end unless defined?(Data)
class Date;class << self;attr_accessor :now;def current;now;end;end;def next_month;self>>1;end;def end_of_month;Date.new(year,month,-1);end;end
class Time;def self.current;Time.now;end;end
class RecurrenceRule;LAST=-1;end
require File.join(ARGV[0],'app/models/recurring_transaction/schedule.rb')
require File.join(ARGV[0],'app/models/recurring_transaction/occurrence_generator.rb')
class RecurringAllocation;class << self;attr_accessor :ids;def select(*);ids;end;end;end
class RecurringOccurrence
 class << self;attr_accessor :rows;end
 def self.insert_all(rows,**)
  added=rows.reject { |r| self.rows.any? { |o| o[:original_due_on]==r[:original_due_on] } };self.rows+=added;Struct.new(:rows).new(added)
 end
end
class Rows
 def initialize(rows=nil);@rows=rows;end
 def rows;@rows||RecurringOccurrence.rows;end
 def open_status;Rows.new(rows.select { |r| r[:status]=='scheduled' });end
 def where(*args,**kw)
  return self if args.empty?&&kw.empty?
  if kw[:due_on];Rows.new(rows.select { |r| kw[:due_on].cover?(r[:due_on]) })
  else;Rows.new(rows.select { |r| r[:due_on]>=args[1] });end
 end
 def not(id:);Rows.new(rows.reject { |r| id.include?(r[:id]) });end
 def delete_all;ids=rows.map { |r| r[:id] };RecurringOccurrence.rows.reject! { |r| ids.include?(r[:id]) };ids.size;end
 def pluck(*);rows.map { |r| [r[:original_due_on],r[:due_on]] };end
end
Series=Struct.new(:schedule,:anchor_date,:end_after_count,:manual,:end_mode,:status) do
 def recurring_occurrences;Rows.new;end;def active?;status=='active';end;def manual?;manual==1;end;def ends_after_count?;end_mode=='after_count';end;def id;'series';end;def family_id;'one';end;def currency;'USD';end
end
def schedule(e)
 rules=e['rules'].map { |r| RecurringTransaction::Schedule::Rule.new(frequency:r['frequency'],interval:r['interval'],day_of_month:r['dayOfMonth'],weekday:r['weekday'],weekday_ordinal:r['weekdayOrdinal'],month_of_year:r['monthOfYear']) }
 RecurringTransaction::Schedule.new(expected_day_of_month:e['expectedDayOfMonth'],rules:rules,anchor_date:Date.parse(e['anchorDate']),weekend_adjust:e['weekendAdjust'],end_mode:e['endMode'],end_on:e['endOn']&&Date.parse(e['endOn']),end_after_count:e['endAfterCount'])
end
output=JSON.parse(STDIN.read).map do |c|
 Date.now=Date.parse(c['asOf']);e=c['entry'];RecurringAllocation.ids=c['state']['recurringAllocations'].map { |a| a['occurrenceId'] };RecurringOccurrence.rows=c['state']['recurringOccurrences'].map { |o| {id:o['id'],original_due_on:Date.parse(o['originalDueOn']),due_on:Date.parse(o['dueOn']),status:o['status'],expected_amount:o['expectedAmount']} }
 series=Series.new(schedule(e),Date.parse(e['anchorDate']),e['endAfterCount'],e['manual'],e['endMode'],e['status']);RecurringTransaction::OccurrenceGenerator.new(series).regenerate_future!(through:Date.parse(c['window']['through']))
 RecurringOccurrence.rows.map { |o| {originalDueOn:o[:original_due_on].iso8601,dueOn:o[:due_on].iso8601,status:o[:status],expectedAmount:o[:expected_amount]} }.sort_by { |o| o[:originalDueOn] }
end
STDOUT.write(JSON.generate(output))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:20_000_000}));cases.forEach((c,i)=>{const actual=planRecurringSave(c.state,c.entry,c.asOf).next.recurringOccurrences.map(({originalDueOn,dueOn,status,expectedAmount})=>({originalDueOn,dueOn,status,expectedAmount})).sort((a,b)=>a.originalDueOn.localeCompare(b.originalDueOn));assert.deepEqual(actual,expected[i],'Original OccurrenceGenerator#regenerate_future! '+i+' '+JSON.stringify(c.entry));});console.log(`Matched ${cases.length} original regeneration callback outcomes across weekly/monthly/yearly intervals, weekend/end policies, declared/detected status and active/paused saves, retaining closed and payment-bearing history at the port's complete finite horizon.`);
