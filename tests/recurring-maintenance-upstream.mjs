import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {generationWindow,materializeRecurringWindow,nextPhaseOccurrence,recurringCycle} from '../lib/recurring-maintenance.ts';import {schedulePhasePairs} from '../lib/recurring.ts';import {matcherEntry,matcherOccurrence} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout.');const cases=[];
for(const shape of ['weekly','month-day','month-last','month-nth','yearly','semimonthly'])for(const interval of [1,2,3])for(const weekendAdjust of ['none','before','after','skip'])for(const endMode of ['never','on_date','after_count'])for(const manual of [0,1])for(const asOf of ['2025-12-20','2026-03-20','2027-01-20']){
 const rule={frequency:shape==='weekly'?'weekly':shape==='yearly'?'yearly':'monthly',interval,dayOfMonth:shape==='month-last'?-1:shape==='weekly'||shape==='month-nth'?null:15,weekday:shape==='weekly'||shape==='month-nth'?1:null,weekdayOrdinal:shape==='month-nth'?-1:null,monthOfYear:shape==='yearly'?2:null},rules=shape==='semimonthly'?[{...rule,dayOfMonth:2},{...rule,dayOfMonth:5}]:[rule],entry=matcherEntry({anchorDate:'2026-01-03',startsOn:'2026-01-03',manual,weekendAdjust,endMode,endOn:'2026-08-31',endAfterCount:8,rules}),window=generationWindow(entry,asOf),stored=[matcherOccurrence({id:'older',originalDueOn:'2026-01-01',dueOn:'2026-01-01',status:'paid'}),matcherOccurrence({id:'override',originalDueOn:'2026-02-15',dueOn:'2026-02-17',expectedAmount:7000})];cases.push({entry,asOf,from:'2025-10-01',through:'2027-05-31',window,stored});
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
def schedule(e)
 rules=e['rules'].map { |r| RecurringTransaction::Schedule::Rule.new(frequency:r['frequency'],interval:r['interval'],day_of_month:r['dayOfMonth'],weekday:r['weekday'],weekday_ordinal:r['weekdayOrdinal'],month_of_year:r['monthOfYear']) }
 RecurringTransaction::Schedule.new(expected_day_of_month:e['expectedDayOfMonth'],rules:rules,anchor_date:Date.parse(e['anchorDate']),weekend_adjust:e['weekendAdjust'],end_mode:e['endMode'],end_on:e['endOn']&&Date.parse(e['endOn']),end_after_count:e['endAfterCount'])
end
class Rows
 def initialize(rows);@rows=rows;end
 def where(due_on:);Rows.new(@rows.select { |r| due_on.cover?(Date.parse(r['dueOn'])) });end
 def pluck(*);@rows.map { |r| [Date.parse(r['originalDueOn']),Date.parse(r['dueOn'])] };end
end
class RecurringOccurrence
 class << self;attr_accessor :rows;end
 def self.insert_all(rows,**)
  new_rows=rows.reject { |r| self.rows.any? { |o| o[:original_due_on]==r[:original_due_on] } };self.rows+=new_rows;Struct.new(:rows).new(new_rows)
 end
end
Series=Struct.new(:schedule,:anchor_date,:end_after_count,:recurring_occurrences,:manual,:end_mode) do
 def active?;true;end;def manual?;manual==1;end;def ends_after_count?;end_mode=='after_count';end;def id;'series';end;def family_id;'one';end;def currency;'USD';end
end
normal=->(pairs) { pairs.map { |p| {originalDueOn:p.original_due_on.iso8601,dueOn:p.due_on.iso8601} } }
results=JSON.parse(STDIN.read).map do |c|
 Date.now=Date.parse(c['asOf']);e=c['entry'];s=schedule(e);series=Series.new(s,Date.parse(e['anchorDate']),e['endAfterCount'],Rows.new(c['stored']),e['manual'],e['endMode']);generator=RecurringTransaction::OccurrenceGenerator.new(series)
 cycle=s.cycle_for(Date.current);from=cycle&.begin||Date.current;from=[from,series.anchor_date].max if series.manual?
 RecurringOccurrence.rows=c['stored'].map { |o| {original_due_on:Date.parse(o['originalDueOn']),due_on:Date.parse(o['dueOn'])} };generator.backfill!(from:Date.parse(c['window']['from']),through:Date.parse(c['window']['through']));generated=RecurringOccurrence.rows.drop(c['stored'].length).map { |p| {originalDueOn:p[:original_due_on].iso8601,dueOn:p[:due_on].iso8601} }
 {pairs:normal.call(s.occurrence_pairs_between(Date.parse(c['from']),Date.parse(c['through']))),cycle:cycle&&{start:cycle.begin.iso8601,end:cycle.end.iso8601},next:s.first_occurrence_after(Date.current)&.iso8601,from:from.iso8601,horizon:generator.send(:default_horizon,s).iso8601,generated:generated}
end
STDOUT.write(JSON.generate(results))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:20_000_000}));let extended=0;
cases.forEach((c,i)=>{const e=expected[i],label='Original Schedule/OccurrenceGenerator '+i+' '+JSON.stringify({rules:c.entry.rules,end:c.entry.endMode,weekend:c.entry.weekendAdjust,manual:c.entry.manual,date:c.asOf});assert.deepEqual(schedulePhasePairs(c.entry,c.from,c.through),e.pairs,label+' phase');assert.deepEqual(recurringCycle(c.entry,c.asOf),e.cycle,label+' cycle');assert.equal(nextPhaseOccurrence(c.entry,c.asOf),e.next,label+' next');assert.equal(c.window.from,e.from,label+' start');assert.ok(c.window.through>=e.horizon,label+' horizon');if(c.window.through!==e.horizon){extended++;assert.equal(c.entry.endMode,'after_count');assert.equal(schedulePhasePairs(c.entry,'1900-01-01',c.window.through).length,c.entry.endAfterCount,label+' complete finite run');}assert.deepEqual(materializeRecurringWindow(c.entry,c.stored,c.window.from,c.window.through).map(({originalDueOn,dueOn})=>({originalDueOn,dueOn})),e.generated,label+' materialized identities/nearest stand-ins');});
console.log(`Matched ${cases.length} original Schedule/OccurrenceGenerator cases for phase pairs, cycles, next occurrence, declared/detected start, finite horizon and materialized identities/nearest stand-ins; ${extended} skipped finite horizons explicitly extended to their complete count.`);
