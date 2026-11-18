import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {emptyState} from '../lib/finance.ts';
import {detectRecurringPrices} from '../lib/recurring-prices.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout path for the original Ruby price detector comparison.');
const cases=[];
for(const currency of ['USD','JPY','KWD'])for(const amount of [10000,10001,10002,9000,12000])for(const difference of [0,currency==='JPY'?0:currency==='KWD'?10:1,currency==='JPY'?1:currency==='KWD'?11:2])for(const counts of [[1,1],[1,2],[0,1]])for(const active of [true,false])for(const history of ['none','same_date','same_price','other_price'])cases.push({currency,amount,difference,counts,active,history});
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';
class RecurringTransaction;end
module ActiveRecord;class RecordNotUnique<StandardError;end;end
class RecurringPriceChange
 class << self;attr_accessor :written;end
 def self.create!(values);self.written << values;end
end
class Query
 def initialize(rows);@rows=rows;end
 def active;Query.new(@rows.select { |r| r.status=='active' });end
 def where(*);Query.new(@rows.select { |r| r.amount>0 });end
 def find_each(&block);@rows.each(&block);end
 def paid;Query.new(@rows.select { |r| r.status=='paid' });end
 def order(key=nil,**kwargs);field=key || kwargs.keys.first;rows=@rows.sort_by { |r| r.public_send(field) };rows=rows.reverse if kwargs[field]==:desc;Query.new(rows);end
 def limit(n);Query.new(@rows.first(n));end
 def includes(*);self;end
 def to_a;@rows;end
 def last;@rows.last;end
 def exists?(**values);@rows.any? { |r| values.all? { |k,v| r.public_send(k)==v } };end
end
Allocation=Struct.new(:allocated_amount,:state,:entry) { def allocation_confirmed?;state=='confirmed';end }
Occurrence=Struct.new(:due_on,:allocations,:status)
History=Struct.new(:effective_on,:new_amount)
Series=Struct.new(:amount,:currency,:recurring_occurrences,:recurring_price_changes,:status) { def manual?;true;end }
require File.join(ARGV.fetch(0),'app/models/recurring_transaction/price_change_detector.rb')
result=JSON.parse(STDIN.read).map do |c|
 places=c['currency']=='JPY' ? 0 : c['currency']=='KWD' ? 3 : 2;scale=BigDecimal((10**places).to_s)
 recent=(0..1).map do |i|
  amount=(i==0 ? c['amount']-c['difference'] : c['amount'])
  Occurrence.new(Date.new(2026,i+1,1),Array.new(c['counts'][i]) { Allocation.new(BigDecimal(amount.to_s)/scale,'confirmed',nil) },'paid')
 end
 history=case c['history']
 when 'same_date' then [History.new(Date.new(2026,2,1),BigDecimal(c['amount'].to_s)/scale)]
 when 'same_price' then [History.new(Date.new(2026,1,15),BigDecimal(c['amount'].to_s)/scale)]
 when 'other_price' then [History.new(Date.new(2026,1,15),BigDecimal((c['amount']+100).to_s)/scale)]
 else [] end
 series=Series.new(BigDecimal('10000')/scale,c['currency'],Query.new(recent),Query.new(history),c['active'] ? 'active' : 'paused')
 RecurringPriceChange.written=[]
 RecurringTransaction::PriceChangeDetector.new(Struct.new(:recurring_transactions).new(Query.new([series]))).detect!
 RecurringPriceChange.written.map { |r| {effectiveOn:r[:effective_on].iso8601,previousAmount:(r[:previous_amount]*scale).to_i,newAmount:(r[:new_amount]*scale).to_i,currency:r[:currency],source:r[:source]} }
end
STDOUT.write(JSON.generate(result))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:5_000_000}));let observations=0;
cases.forEach((c,index)=>{
 const s=structuredClone(emptyState);s.recurringEntries=[{id:'r',name:'Bill',status:c.active?'active':'paused',amount:-10000,currency:c.currency}];
 s.recurringOccurrences=[1,2].map(i=>({id:'o'+i,recurringEntryId:'r',dueOn:`2026-0${i}-01`,originalDueOn:`2026-0${i}-01`,status:'paid'}));
 s.recurringAllocations=c.counts.flatMap((count,i)=>Array.from({length:count},(_,j)=>({id:`p${i}-${j}`,occurrenceId:'o'+(i+1),state:'confirmed',currency:c.currency,amount:c.amount-(i===0?c.difference:0),paidOn:`2026-0${i+1}-01`,transactionId:null})));
 if(c.history!=='none')s.recurringPriceChanges=[{id:'h',recurringEntryId:'r',effectiveOn:c.history==='same_date'?'2026-02-01':'2026-01-15',currency:c.currency,newAmount:c.amount+(c.history==='other_price'?100:0)}];
 const actual=detectRecurringPrices(s,'2026-02-03').map(({effectiveOn,previousAmount,newAmount,currency,source})=>({effectiveOn,previousAmount,newAmount,currency,source}));
 assert.deepEqual(actual,expected[index],`Original Ruby recurring-price detector case ${index}: ${JSON.stringify(c)}`);observations+=actual.length;
});
console.log(`Matched ${cases.length} cases and ${observations} observations against Sure's original PriceChangeDetector: whole/two/three-decimal currencies, epsilon boundaries, active state, single/multiple payments and history deduplication.`);
