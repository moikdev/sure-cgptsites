import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {planRecurringCleanup} from '../lib/recurring-cleanup.ts';import {recurringDetectionSources} from '../lib/recurring-detection.ts';import {matcherState,matcherEntry,matcherTransaction} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout.');const cases=[];
for(const frequency of ['weekly','monthly','yearly'])for(const interval of [1,3])for(const manual of [0,1,null])for(const reference of [null,'2024-01-15','2025-09-29','2026-01-29','2026-03-15'])for(const activity of ['none','recent','wrong-name','wrong-amount','wrong-sign','wrong-currency','wrong-account','merchant','future','variance','income']){
 const s=matcherState();s.transactions=[];s.recurringOccurrences=[];Object.assign(s.recurringEntries[0],{manual,lastOccurrenceOn:reference,anchorDate:'2025-01-15',startsOn:'2025-01-15',rules:[{frequency,interval,dayOfMonth:frequency==='weekly'?null:15,weekday:frequency==='weekly'?0:null,weekdayOrdinal:null,monthOfYear:frequency==='yearly'?2:null}]});if(activity!=='none'){const t=matcherTransaction({date:activity==='future'?'2026-04-15':'2026-02-15'});if(activity==='wrong-name')t.name='Other';if(activity==='wrong-amount')t.amount=-10001;if(activity==='wrong-sign')t.amount=10000;if(activity==='wrong-currency')s.accounts[0].currency='EUR';if(activity==='wrong-account'){s.accounts.push({...s.accounts[0],id:'other'});t.accountId='other';}if(activity==='merchant'){s.merchants=[{id:'m',ownerId:'one',name:'Vendor',color:'#445566',websiteUrl:null}];t.merchantId='m';t.name='Different descriptor';s.recurringEntries[0].merchantId='m';}if(activity==='variance'){t.amount=-11000;Object.assign(s.recurringEntries[0],{expectedAmountMin:9000,expectedAmountMax:12000});}if(activity==='income'){t.amount=10000;Object.assign(s.recurringEntries[0],{amount:10000,billType:'income'});}s.transactions=[t];}cases.push({state:s,asOf:'2026-03-31',evaluatedAt:'2026-03-31T12:30:45.123Z',operation:'retire'});
}
for(const manual of [0,1,null])for(const status of ['inactive','active','paused','ended','suggested'])for(const updatedAt of [undefined,'2025-09-30T12:30:45.122Z','2025-09-30T12:30:45.123Z','2025-09-30T12:30:45.124Z']){const s=matcherState();s.transactions=[];s.recurringOccurrences=[];Object.assign(s.recurringEntries[0],{manual,status,updatedAt});cases.push({state:s,asOf:'2026-03-31',evaluatedAt:'2026-03-31T12:30:45.123Z',operation:'purge'});}
const ruby=String.raw`
require 'json';require 'date';require 'time';require 'bigdecimal'
class Object;def present?;!nil?&&self!=false&&(!respond_to?(:empty?)||!empty?);end;def presence;present? ? self : nil;end;end
class Struct;def with(**attrs);self.class.new(**to_h.merge(attrs));end;end
class Date;class << self;attr_accessor :now;def current;now.to_date;end;end;def to_date;self;end;def next_month;self>>1;end;def end_of_month;Date.new(year,month,-1);end;end
class Time;def to_date;Date.new(year,month,day);end;end
Span=Struct.new(:n,:months) do
 def ago
  now=Date.now;return now-n*86400 unless months
  d=now.to_date<<n;Time.utc(d.year,d.month,d.day,now.hour,now.min,now.sec+now.subsec)
 end
end
class Integer;def months;Span.new(self,true);end;def days;Span.new(self,false);end;end
class RecurrenceRule;LAST=-1;end
class Transaction;attr_accessor :merchant_id;def initialize(id);@merchant_id=id;end;end
Entry=Struct.new(:id,:name,:amount,:date,:currency,:account_id,:entryable,:entryable_type)
class Query
 include Enumerable
 attr_reader :rows
 def initialize(rows);@rows=rows;end;def each(&b);rows.each(&b);end;def order(**);self;end;def includes(*);self;end;def active;Query.new(rows.select { |r| r.status=='active' });end;def inactive;Query.new(rows.select { |r| r.status=='inactive' });end;def find_each(&b);rows.each(&b);end
 def where(*args,**kw)
  Query.new(rows.select do |r|
   if args.empty?;kw.all? { |k,v| r.public_send(k)==v }
   elsif args[0].include?('updated_at');r.updated_at&&r.updated_at<args[1]
   elsif args[0].include?('BETWEEN');r.amount>=args[1]&&r.amount<=args[2]
   elsif args[0].include?('amount =');r.amount==args[1]
   else;day=[kw[:expected_day],Date.new(r.date.year,r.date.month,-1).day].min;distance=(r.date.day-day).abs;[distance,31-distance].min<=kw[:tolerance]
   end
  end)
 end
 def destroy_all;rows.each { |r| r.deleted=true };rows;end
end
require File.join(ARGV[0],'app/models/recurring_transaction/schedule.rb')
require File.join(ARGV[0],'app/models/recurring_transaction/cleaner.rb')
source=File.read(File.join(ARGV[0],'app/models/recurring_transaction.rb'))
%w[matching_transactions has_amount_variance? staleness_threshold_date should_be_inactive? amount_window_scope schedule_matched day_of_month_scope].each do |name|
 pattern=/^([ ]{2,4})def #{Regexp.escape(name)}(?:\([^\n]*\))?\n.*?^\1end$/m;code=source[pattern];raise "Missing method #{name}" unless code;RecurringTransaction.class_eval(code)
end
class RecurringTransaction
 attr_accessor :id,:name,:account,:family,:currency,:merchant_id,:amount,:expected_amount_min,:expected_amount_max,:expected_day_of_month,:schedule,:last_occurrence_date,:manual,:status,:updated_at,:deleted,:matcher_name
 def transfer?;false;end;def manual?;manual==true;end;def mark_inactive!;self.status='inactive';end
end
Family=Struct.new(:entries,:recurring_transactions)
output=JSON.parse(STDIN.read).map do |c|
 Date.now=Time.iso8601(c['evaluatedAt']);e=c['state']['recurringEntries'][0];r=RecurringTransaction.new;r.id=e['id'];r.name=e['name'];r.matcher_name=e.dig('matching','detectedName')||e['name'];r.amount=-e['amount'];r.expected_amount_min=e['expectedAmountMin']&&(e['amount']>0 ? -e['expectedAmountMax'] : e['expectedAmountMin']);r.expected_amount_max=e['expectedAmountMax']&&(e['amount']>0 ? -e['expectedAmountMin'] : e['expectedAmountMax']);r.currency=e['currency'];r.expected_day_of_month=e['expectedDayOfMonth'];r.manual=e['manual'].nil? ? nil : e['manual']==1;r.status=e['status'];r.last_occurrence_date=e['lastOccurrenceOn']&&Date.parse(e['lastOccurrenceOn']);r.updated_at=e['updatedAt']&&Time.iso8601(e['updatedAt']);r.merchant_id=e['merchantId']
 rules=e['rules'].map { |v| RecurringTransaction::Schedule::Rule.new(frequency:v['frequency'],interval:v['interval'],day_of_month:v['dayOfMonth'],weekday:v['weekday'],weekday_ordinal:v['weekdayOrdinal'],month_of_year:v['monthOfYear']) };r.schedule=RecurringTransaction::Schedule.new(expected_day_of_month:e['expectedDayOfMonth'],rules:rules,anchor_date:Date.parse(e['anchorDate']))
 entries=c['sources'].map { |v| Entry.new(v['id'],v['name'],-v['amount'],Date.parse(v['date']),v['currency'],v['accountId'],Transaction.new(v['merchantId']),'Transaction') };r.family=Family.new(Query.new(entries),Query.new([r]));r.account=e['accountId']&&Struct.new(:entries).new(Query.new(entries.select { |v| v.account_id==e['accountId'] }));cleaner=RecurringTransaction::Cleaner.new(r.family)
 if c['operation']=='retire';count=cleaner.cleanup_stale_transactions;{retire:count,purge:0,threshold:r.staleness_threshold_date.iso8601}
 else;cleaner.remove_old_inactive_transactions;{retire:0,purge:r.deleted ? 1 : 0}
 end
end
STDOUT.write(JSON.generate(output))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases.map(c=>({...c,sources:recurringDetectionSources(c.state)}))),encoding:'utf8',maxBuffer:20_000_000}));cases.forEach((c,i)=>{const result=planRecurringCleanup(c.state,c);assert.equal(result.counts.retire,expected[i].retire,'Original Cleaner retirement '+i);assert.equal(result.counts.purge,expected[i].purge,'Original Cleaner removal '+i);if(expected[i].threshold)assert.equal(result.rows[0].threshold,expected[i].threshold,'Original cycle threshold '+i);});console.log(`Matched ${cases.length} original Cleaner/model outcomes using original Schedule, staleness, exact name/merchant/native amount/day filters and strict six-month inactive-removal semantics.`);
