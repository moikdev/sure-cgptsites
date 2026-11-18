import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {recurringNotices} from '../lib/recurring-lifecycle.ts';import {matcherState} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure source checkout.');const cases=[];
for(const trial of [-1,0,3,4,14,15])for(const renewal of [-1,0,3,4,14,15])for(const price of [-31,-30,-5,0,20])for(const amount of [0,9900,9950,10000,10050,10999,11000])for(const active of [true,false])cases.push({trial,renewal,price,amount,active});
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'bigdecimal/util'
class Data;def self.define(*members,&block);Struct.new(*members,keyword_init:true,&block);end;end unless defined?(Data)
class Date;def self.current;new(2026,1,15);end;end
class ApplicationController;def self.before_action(*);end;def self.helper_method(*);end;end
module RecurringFeatureGuardable;end
class ApplicationRecord;def self.method_missing(*);end;end
module Monetizable;end
require File.join(ARGV.fetch(0),'app/models/recurring_price_change.rb')
class RecurringPriceChange
 attr_accessor :id,:recurring_transaction,:recurring_transaction_id,:effective_on,:previous_amount,:new_amount
 class << self;attr_accessor :rows;end
 def self.where(*args,**kwargs);Query.new(rows).where(*args,**kwargs);end
end
require File.join(ARGV.fetch(0),'app/controllers/bills_controller.rb')
Series=Struct.new(:id,:status,:trial_ends_on,:renews_on)
class Query
 def initialize(rows);@rows=rows;end
 def active;Query.new(@rows.select { |row| row.status=='active' });end
 def where(*args,**kwargs)
  Query.new(@rows.select do |row|
   args.empty? ? kwargs.all? { |key,value| value.is_a?(Range) ? value.cover?(row.public_send(key)) : Array(value).include?(row.public_send(key)) } : row.effective_on>=args[1]
  end)
 end
 def select(key);@rows.map { |row| row.public_send(key) };end
 def includes(*);self;end
 def find_each(&block);@rows.sort_by(&:id).each(&block);end
end
module Current;class << self;attr_accessor :family;end;end
result=JSON.parse(STDIN.read).map do |c|
 now=Date.current;series=Series.new('series',c['active'] ? 'active' : 'paused',now+c['trial'],now+c['renewal'])
 Current.family=Struct.new(:recurring_transactions).new(Query.new([series]))
 change=RecurringPriceChange.new;change.id='price';change.recurring_transaction=series;change.recurring_transaction_id=series.id;change.effective_on=now+c['price'];change.previous_amount=BigDecimal('10000');change.new_amount=BigDecimal(c['amount'].to_s);RecurringPriceChange.rows=[change]
 controller=BillsController.new;controller.define_singleton_method(:payable_series_ids) { ['series'] }
 controller.send(:collect_notices).map { |n| {kind:n.kind.to_s,date:n.date.iso8601,urgent:n.urgent?,percent:n.price_percent.to_i} }
end
STDOUT.write(JSON.generate(result))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8_000_000}));const at=n=>new Date(Date.UTC(2026,0,15+n)).toISOString().slice(0,10);let notices=0;
cases.forEach((c,i)=>{const s=matcherState();Object.assign(s.recurringEntries[0],{status:c.active?'active':'paused',trialEndsOn:at(c.trial),renewsOn:at(c.renewal)});s.recurringPriceChanges=[{id:'price',ownerId:'one',recurringEntryId:'series',effectiveOn:at(c.price),previousAmount:10000,newAmount:c.amount,currency:'USD',source:'user',transactionId:null}];const actual=recurringNotices(s,'2026-01-15').map(n=>({kind:n.kind,date:n.date,urgent:n.urgent,percent:n.percentChange??0}));assert.deepEqual(actual,expected[i],`Original BillsController notice case ${i}: ${JSON.stringify(c)}`);notices+=actual.length;});
console.log(`Matched ${cases.length} lifecycle notice cases (${notices} notices) against Sure's original BillsController and RecurringPriceChange: inclusive windows, active scope, urgency/order, materiality and signed percentage rounding.`);
