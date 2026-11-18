import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {explainRecurringMatch,matcherDefaults} from '../lib/recurring-matcher.ts';import {matcherState} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout for the original Ruby matcher comparison.');
const cases=[];
for(const currency of ['USD','JPY','KWD'])for(const delta of [0,1,9,10,11,100,749,750,751,1000,2000,2501])for(const offset of [-3,-2,0,3,7,8,16])for(const identity of ['name','alias','merchant','unrelated'])for(const learned of ['0','20'])for(const snooze of [0,10])cases.push({currency,delta,offset,identity,learned,snooze});
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'bigdecimal/util';require 'set';
class Data;def self.define(*members);Struct.new(*members,keyword_init:true);end;end unless defined?(Data)
class Object;def present?;!nil? && self!=false && (!respond_to?(:empty?) || !empty?);end;end
class RecurringTransaction;end
require File.join(ARGV.fetch(0),'app/models/recurring_transaction/matcher.rb')
Schedule=Struct.new(:occurrences_per_year)
Series=Struct.new(:id,:currency,:account_id,:merchant_id,:amount,:amount_tolerance_pct,:matcher_hints,:known_names,:match_days_early,:match_days_late,:schedule) { def transfer?;false;end }
Occurrence=Struct.new(:id,:recurring_transaction,:effective_due_on,:resolved_expected_amount) { def derived_state;:overdue;end }
Entryable=Struct.new(:merchant_id) { def transfer?;false;end }
Entry=Struct.new(:currency,:account_id,:amount,:name,:date,:entryable)
result=JSON.parse(STDIN.read).map do |c|
 scale=BigDecimal((c['currency']=='JPY' ? 1 : c['currency']=='KWD' ? 1000 : 100).to_s)
 merchant=c['identity']=='merchant' ? 'm' : nil
 series=Series.new('r',c['currency'],'cash',merchant,BigDecimal('10000')/scale,BigDecimal('7.5'),{'learned_tolerance_pct'=>c['learned']},Set.new(['monthly bill','alias']),2,7,Schedule.new(12))
 occurrence=Occurrence.new('o',series,Date.new(2026,1,15)+c['snooze'],BigDecimal('10000')/scale)
 entry=Entry.new(c['currency'],'cash',BigDecimal((10000+c['delta']).to_s)/scale,c['identity']=='unrelated' ? 'Stranger' : c['identity']=='alias' ? 'Alias' : 'Monthly bill',Date.new(2026,1,15)+c['offset'],Entryable.new(merchant))
 matcher=RecurringTransaction::Matcher.new(nil)
 # Freeze Date.current for the original snooze-aware window implementation.
 explanation=matcher.explain(occurrence,entry)
 explanation ? {confidence:(explanation.confidence*10000).round.to_i,signals:explanation.signals.transform_values { |v| (v*10000).round.to_i }} : nil
end
STDOUT.write(JSON.generate(result))
`;
// Date.current is the only ActiveSupport time helper needed by the original matcher.
const code=ruby.replace("class RecurringTransaction;end","class Date;def self.current;new(2026,1,31);end;end\nclass RecurringTransaction;end");
const expected=JSON.parse(execFileSync('ruby',['-e',code,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8_000_000}));let matches=0;
cases.forEach((c,index)=>{const s=matcherState(),entry=s.recurringEntries[0],occurrence=s.recurringOccurrences[0];s.accounts[0].currency=c.currency;entry.currency=c.currency;occurrence.currency=c.currency;entry.matching={...matcherDefaults(),enabled:true,learnedTolerancePct:c.learned,aliases:['Alias']};if(c.identity==='merchant')entry.merchantId='m';if(c.snooze)occurrence.snoozedUntil='2026-01-25';const transaction={...s.transactions[0],date:new Date(Date.UTC(2026,0,15+c.offset)).toISOString().slice(0,10)};const row=explainRecurringMatch(s,entry,occurrence,{transaction,splitLineId:null,name:c.identity==='unrelated'?'Stranger':c.identity==='alias'?'Alias':'Monthly bill',merchantId:c.identity==='merchant'?'m':null,amount:-(10000+c.delta)},'2026-01-31');const actual=row?{confidence:row.confidence,signals:row.signals}:null;assert.deepEqual(actual,expected[index],`Ruby matcher case ${index}: ${JSON.stringify(c)}`);if(actual)matches++;});
console.log(`Matched ${cases.length} explanations (${matches} eligible) against Sure's original Ruby Matcher: currency precision/epsilon, tolerance/learned bands, identity, date decay, snooze and overdue windows.`);
