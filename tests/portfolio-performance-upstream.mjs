import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {recordedMarketChange,marketChangePercent} from '../lib/portfolio-performance.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';
assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
let seed=73;const random=max=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%max;},cases=[];
for(let i=0;i<600;i++){
 const opening=random(2_000_000)-500_000,holdings=[random(100000)],trades=[];
 for(let d=0;d<28;d++){holdings.push(random(200000));trades.push(Array.from({length:random(5)},()=>({qty:random(3)-1,cash:random(20000)-10000})));}
 const cash=trades.flat().filter(t=>t.qty!==0).reduce((sum,t)=>sum+t.cash,0),change=recordedMarketChange(holdings[0],holdings.at(-1),cash);cases.push({opening,holdings,trades,expected:{change,percent:marketChangePercent(change,opening)}});
}
for(const [opening,change] of [[2000,-1],[2000,1],[-100,50],[0,0],[0,50]])cases.push({opening,holdings:[0,change],trades:[[]],expected:{change,percent:marketChangePercent(change,opening)}});
const ruby=String.raw`
require 'json';require 'date'
class Date;def prev_day;self-1;end;end
class Balance;end
module ActiveModel;module Validations;def self.included(base);base.define_singleton_method(:validates){|*args|};end;end;end
load File.join(ARGV[0],'app/models/balance/base_calculator.rb')
load File.join(ARGV[0],'app/models/trend.rb')
AccountFixture=Struct.new(:balance_type)
# Only the already-materialized holding lookup is replaced. The actual source
# flows_for_date and market_value_change_on_date run with inverse entry signs.
TradeFixture=Struct.new(:qty)
EntryFixture=Struct.new(:amount,:entryable) do
 def trade?;true;end
 def transaction?;false;end
end
CacheFixture=Struct.new(:entries) do
 def get_entries(_date);entries;end
end
class FixtureCalculator < Balance::BaseCalculator
 attr_accessor :day,:holdings,:entries
 private
 def sync_cache;CacheFixture.new(entries);end
 def holdings_value_for_date(date);holdings[(date-Date.new(2026,2,1)).to_i];end
end
result=JSON.parse(STDIN.read).map do |row|
 calculator=FixtureCalculator.new(AccountFixture.new(:investment));calculator.holdings=row['holdings'];change=0
 row['trades'].each_with_index do |trades,index|
  date=Date.new(2026,2,2)+index;calculator.entries=trades.map{|t|EntryFixture.new(-t['cash'],TradeFixture.new(t['qty']))}
  change+=calculator.send(:market_value_change_on_date,date,calculator.send(:flows_for_date,date))
 end
 opening=row['opening'];trend=Trend.allocate;trend.instance_variable_set(:@previous,opening);trend.instance_variable_set(:@current,opening+change)
 {change:change,percent:opening.zero? ? nil : trend.percent}
end
puts JSON.generate(result)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:5_000_000}));assert.deepEqual(actual,cases.map(c=>c.expected));console.log(`${cases.length} pinned Ruby daily market-flow and Trend percentage cases matched`);
