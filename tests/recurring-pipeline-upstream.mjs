import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {planRecurringRepairs} from '../lib/recurring-repair.ts';import {planRecurringMaintenance} from '../lib/recurring-maintenance.ts';import {matcherState,matcherEntry,matcherOccurrence,matcherTransaction} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout.');const cases=[];
for(const currency of ['USD','JPY','KWD'])for(const income of [false,true])for(const source of ['auto_matched','user_confirmed','user_created'])for(const name of ['Monthly bill POSTED','Monthly','Other merchant','  MONTHLY   BILL  '])for(const merchant of ['none','same','different'])for(const gate of ['match','wrong_date','wrong_amount','claimed','wrong_account','no_date']){
 const s=matcherState();s.accounts[0].currency=currency;s.accounts.push({...s.accounts[0],id:'other'});s.recurringEntries[0]=matcherEntry({currency,amount:income?10000:-10000,billType:income?'income':'bill',merchantId:merchant==='none'?null:'merchant'});s.recurringOccurrences[0]=matcherOccurrence({status:'paid',currency});s.transactions[0]=matcherTransaction({name,merchantId:merchant==='same'?'merchant':merchant==='different'?'other':null,amount:(income?1:-1)*(gate==='wrong_amount'?9999:10000),date:gate==='wrong_date'?'2026-01-16':'2026-01-15',accountId:gate==='wrong_account'?'other':'cash'});s.recurringAllocations=[{id:'payment',ownerId:'one',occurrenceId:'occurrence',transactionId:null,splitLineId:null,amount:10000,currency,sourceAmount:10000,sourceCurrency:currency,state:'confirmed',source,paidOn:gate==='no_date'?null:'2026-01-15'}];if(gate==='claimed')s.recurringAllocations.push({...s.recurringAllocations[0],id:'claim',transactionId:'transaction'});cases.push(s);
}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal'
class Object;def present?;!nil?&&self!=false&&(!respond_to?(:empty?)||!empty?);end;end
class Data;def self.define(*members,&block);Struct.new(*members,keyword_init:true,&block);end;end unless defined?(Data)
require File.join(ARGV[0],'app/models/recurring_transaction/matcher.rb')
class Query
 include Enumerable
 def initialize(rows);@rows=rows;end
 def each(&b);@rows.each(&b);end;def find_each(&b);each(&b);end
 def joins(*);self;end;def includes(*);self;end
 def where(**kw);return self if kw.empty?;Query.new(@rows.select { |r| kw.all? { |k,v| k==:entryable_type||k==:recurring_occurrences||Array(v).include?(r.public_send(k))||(v.nil?&&r.public_send(k).nil?) } });end
 def not(**kw);Query.new(@rows.reject { |r| kw.all? { |k,v| Array(v).include?(r.public_send(k))||(v.nil?&&r.public_send(k).nil?) } });end
 def select(key);@rows.map { |r| r.public_send(key) };end
end
class RecurringAllocation
 class << self;attr_accessor :rows;def joins(*);Query.new(rows);end;def where(**kw);Query.new(rows).where(**kw);end;end
end
Series=Struct.new(:id,:name,:account_id,:merchant_id,:destination_account_id,:names) do;def transfer?;false;end;def known_names;names;end;end
Occurrence=Struct.new(:recurring_transaction)
Allocation=Struct.new(:id,:recurring_occurrence,:entry_id,:source_amount,:allocated_amount,:currency,:source_currency,:paid_on,:source) do;def update!(entry:);self.entry_id=entry.id;end;end
Transaction=Struct.new(:merchant_id)
Entry=Struct.new(:id,:name,:account_id,:amount,:currency,:date,:entryable)
input=JSON.parse(STDIN.read)
repairs=input.map do |s|
 e=s['recurringEntries'][0];series=Series.new(e['id'],e['name'],e['accountId'],e['merchantId'],nil,[e['name'].downcase.strip]);occurrence=Occurrence.new(series);scale=BigDecimal((10**(e['currency']=='JPY' ? 0 : e['currency']=='KWD' ? 3 : 2)).to_s)
 RecurringAllocation.rows=s['recurringAllocations'].map { |a| Allocation.new(a['id'],occurrence,a['transactionId'],a['sourceAmount']&&BigDecimal(a['sourceAmount'].to_s)/scale,BigDecimal(a['amount'].to_s)/scale,a['currency'],a['sourceCurrency'],a['paidOn']&&Date.parse(a['paidOn']),a['source']) }
 accounts=s['accounts'].to_h { |a| [a['id'],a] };entries=s['transactions'].map { |t| Entry.new(t['id'],t['name'],t['accountId'],-BigDecimal(t['amount'].to_s)/scale,accounts[t['accountId']]['currency'],Date.parse(t['date']),Transaction.new(t['merchantId'])) }
 family=Struct.new(:id,:entries).new('one',Query.new(entries));RecurringTransaction::Matcher.new(family).repair_orphans!;RecurringAllocation.rows[0].entry_id
end
# Exercise the actual orchestrator separately from the independently compared stage algorithms.
require File.join(ARGV[0],'app/models/recurring_transaction/pipeline.rb')
$events=[]
class RecurringTransaction::Identifier;def initialize(*);end;def identify_recurring_patterns;$events<<'discovery';7;end;end
class RecurringTransaction::OccurrenceGenerator;def initialize(*);end;def generate!;$events<<'generation';end;end
class RecurringTransaction::Matcher;def repair_orphans!;$events<<'repair';end;def run!;$events<<'live_matching';end;end
class RecurringTransaction::PriceChangeDetector;def initialize(*);end;def detect!;$events<<'price_observation';end;end
class RecurringTransaction::HistoryBackfiller;def initialize(*,**);end;def run!;$events<<'history';end;end
class Query;def active;self;end;end
stages=[false,true].map { |backfill| $events=[];family=Struct.new(:recurring_transactions).new(Query.new([Object.new]));count=RecurringTransaction::Pipeline.new(family).run!(backfill:backfill);{count:count,stages:$events} }
STDOUT.write(JSON.generate({repairs:repairs,stages:stages}))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:20_000_000}));cases.forEach((s,i)=>assert.equal(planRecurringRepairs(s).next.recurringAllocations[0].transactionId,expected.repairs[i],'Original Matcher#repair_orphans! '+i));
for(const [i,backfill] of [false,true].entries()){const s=matcherState();s.recurringEntries[0].manual=1;assert.deepEqual(planRecurringMaintenance(s,{asOf:'2026-03-20',mode:'pipeline',backfill}).stages,expected.stages[i].stages);assert.equal(expected.stages[i].count,7);}
console.log(`Matched ${cases.length} original Matcher#repair_orphans! cases across native precision, incoming/outgoing signs, allocation source, descriptor/merchant identity, exact date/amount/account and already-used entries; both original Pipeline#run! stage orders also match.`);
