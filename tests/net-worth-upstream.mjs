import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';import {WORTH_GROUPS,worthDates,worthTrend} from '../lib/net-worth-report.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const models=['depository','investment','crypto','property','vehicle','other_asset','credit_card','loan','other_liability'];for(let i=0;i<models.length;i++)assert.ok(readFileSync(`${reference}/app/models/${models[i]}.rb`,'utf8').includes('"'+WORTH_GROUPS[i].color+'"'));
let seed=747;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;},cases=[];for(let i=0;i<800;i++){const groups=WORTH_GROUPS.map(g=>({name:g.name,color:g.color,classification:g.classification,value:random(200001)-100000})),assets=groups.filter(g=>g.classification==='asset').reduce((n,g)=>n+g.value,0),liabilities=groups.filter(g=>g.classification==='liability').reduce((n,g)=>n+g.value,0),current=assets-liabilities,previous=i%9===0?0:random(200001)-100000;cases.push({groups,current,previous,first:i%11===0,from:['2024-01-31','2025-01-31','2024-02-29','2026-04-30'][i%4],to:'2026-09-30'});}
const ruby=String.raw`
require 'json';require 'date'
module ActiveModel
 module Validations
  def self.included(base);base.extend(ClassMethods);end
  module ClassMethods;def validates(*);end;end
  def validate!;end
 end
end
class Inquiry<String;def up?;self=='up';end;def down?;self=='down';end;def flat?;self=='flat';end;end
class String;def inquiry;Inquiry.new(self);end;end
class Object;def presence_in(list);list.include?(self) ? self : nil;end;end
class Money
 include Comparable
 attr_reader :amount
 def initialize(a,c=nil);@amount=a;end
 def <=>(other);amount<=>(other.is_a?(Money) ? other.amount : other);end
 def ==(other);other.is_a?(Money) && amount==other.amount;end
 def -(other);Money.new(amount-other.amount);end
 def zero?;amount.zero?;end
 def negative?;amount.negative?;end
 def to_f;amount.to_f;end
 def for_display;self;end
end
class BalanceSheet;end
load File.join(ARGV[0],'app/models/trend.rb')
load File.join(ARGV[0],'app/models/balance_sheet/net_worth_breakdown_series_builder.rb')
family=Struct.new(:currency).new('NATIVE');builder=BalanceSheet::NetWorthBreakdownSeriesBuilder.new(family)
results=JSON.parse(STDIN.read).map do |c|
 date=Date.new(2026,9,30);value=Struct.new(:date,:date_formatted,:value).new(date,'Sep 30',Money.new(c['current']));previous=c['first'] ? nil : Struct.new(:value).new(Money.new(c['previous']));groups=c['groups'].map{|g|{name:g['name'],color:g['color'],classification:g['classification'],values_by_date:{date=>Money.new(g['value'])}}}
 r=builder.send(:breakdown_value,value,previous,groups);trend=r[:trend];percent=trend.percent
 dates=[];at=Date.iso8601(c['from']);finish=Date.iso8601(c['to']);while at<=finish;dates<<at.iso8601;at=at>>1;end;dates<<finish.iso8601 unless dates.last==finish.iso8601
 {value:r[:value].amount,assets:r[:assets].amount,liabilities:r[:liabilities].amount,change:trend.value.amount,direction:trend.direction.to_s,percent:percent.finite? ? percent : nil,infinite:percent.finite? ? 0 : percent>0 ? 1 : -1,groups:r[:groups].map{|g|g.merge(value:g[:value].amount)},dates:dates}
end
puts JSON.generate(results)
`;
const source=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:10e6}));let groups=0;for(let i=0;i<source.length;i++){const c=cases[i],s=source[i],t=worthTrend(c.current,c.first?c.current:c.previous);assert.equal(t.change,s.change);assert.equal(t.direction,s.direction);assert.equal(t.infinite,s.infinite);assert.equal(t.percent===null?null:Number(t.percent),s.percent);assert.equal(s.value,c.current);assert.equal(s.assets,c.groups.filter(g=>g.classification==='asset').reduce((n,g)=>n+g.value,0));assert.equal(s.liabilities,c.groups.filter(g=>g.classification==='liability').reduce((n,g)=>n+g.value,0));assert.deepEqual(s.groups,c.groups);assert.deepEqual(worthDates(c.from,c.to,'2026-10-15'),s.dates);groups+=s.groups.length;}
console.log(`PASS ${source.length} cases and ${groups} classified group values executing actual pinned Trend and NetWorthBreakdownSeriesBuilder point assembly; native display units, no Rails validations/relations/PostgreSQL balance query or archive-cutoff execution; Ruby Date month stepping is an independent calendar oracle`);
