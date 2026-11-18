import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {createPaycheckPlan} from '../lib/paycheck.ts';import {matcherState,matcherEntry,matcherOccurrence} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure source checkout.');const cases=[];
for(const income of [10000,184000])for(const cash of [null,-10000,0,4000,50000])for(const amount of [0,9000,15000,215000,400000])for(const due of [-3,1,5,10,17,24])for(const snooze of [0,10])for(const first of [0,3])for(const limit of [1,3,6])cases.push({income,cash,amount,due,snooze,first,limit});
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal'
class Object;def present?;!nil? && self!=false && (!respond_to?(:empty?) || !empty?);end;end
class Data;def self.define(*members,&block);Struct.new(*members,keyword_init:true,&block);end;end unless defined?(Data)
class Date;def self.current;new(2026,1,1);end;end
class Money
 attr_reader :amount
 def initialize(amount);@amount=BigDecimal(amount.to_s);end
 def exchange_to(*);self;end
end
class RecurringTransaction;end
require File.join(ARGV.fetch(0),'app/models/recurring_transaction/paycheck_planner.rb')
Series=Struct.new(:display_name)
Occurrence=Struct.new(:id,:recurring_transaction_id,:due_on,:effective_due_on,:value,:recurring_transaction) do
 def resolved_expected_amount_money;Money.new(value);end
 def remaining_amount_money;Money.new(value);end
end
result=JSON.parse(STDIN.read).map do |c|
 now=Date.current;incomes=(0..3).map { |i| due=now+c['first']+7*i;Occurrence.new('pay'+i.to_s,'pay',due,due,c['income'],Series.new('Paycheck')) }
 bills=[['rent',c['amount'],c['due'],c['snooze']],['internet',9000,c['first']+2,0],['water',6400,1,0]].map { |id,amount,offset,snooze| due=now+offset;Occurrence.new(id,id,due,due+snooze,amount,Series.new(id)) }
 planner=RecurringTransaction::PaycheckPlanner.new(Struct.new(:currency).new('USD'),user:nil)
 planner.define_singleton_method(:upcoming_income_occurrences) { incomes }
 planner.define_singleton_method(:open_payable_occurrences) { |through| bills.select { |b| b.effective_due_on<=through } }
 planner.define_singleton_method(:cash_on_hand) { c['cash'].nil? ? nil : BigDecimal(c['cash'].to_s) }
 planner.plan(periods_limit:c['limit']).map do |p|
  {startsOn:p.starts_on.iso8601,endsOn:p.ends_on.iso8601,income:p.income.to_i,dueTotal:p.due_total.to_i,reservedTotal:p.reserved_total.to_i,obligationTotal:p.obligation_total.to_i,remaining:p.remaining.to_i,leading:p.leading,final:p.final,bridge:p.bridge?,cashOnHand:p.cash_on_hand&.to_i,cashAfterObligations:p.cash_after_obligations&.to_i,short:p.short? ? true : false,shortfall:p.shortfall.to_i,items:p.items.map { |i| {id:i.occurrence.id,share:i.share.to_i,total:i.remaining_total.to_i,due:i.due_in_period} }.sort_by { |i| [i[:id],i[:due] ? 0 : 1] }}
 end
end
STDOUT.write(JSON.generate(result))
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:35_000_000})),at=offset=>new Date(Date.UTC(2026,0,1+offset)).toISOString().slice(0,10);let periods=0;
cases.forEach((c,index)=>{const s=matcherState();s.accounts=c.cash===null?[]:[{...s.accounts[0],openingDate:at(-365),openingBalance:c.cash,cashPlanningExcluded:0}];s.transactions=[];s.recurringEntries=[matcherEntry({id:'pay',name:'Paycheck',manual:1,amount:c.income,billType:'income',anchorDate:at(c.first),startsOn:at(c.first),expectedDayOfMonth:Number(at(c.first).slice(8)),endMode:'after_count',endAfterCount:4,rules:[{frequency:'weekly',interval:1,weekday:new Date(at(c.first)).getUTCDay(),dayOfMonth:null,weekdayOrdinal:null,monthOfYear:null}]})];s.recurringOccurrences=[0,1,2,3].map(i=>matcherOccurrence({id:'pay'+i,recurringEntryId:'pay',originalDueOn:at(c.first+7*i),dueOn:at(c.first+7*i)}));for(const [id,amount,due,snooze] of [['rent',c.amount,c.due,c.snooze],['internet',9000,c.first+2,0],['water',6400,1,0]]){s.recurringEntries.push(matcherEntry({id,name:id,amount:-amount,anchorDate:at(due),startsOn:at(due),expectedDayOfMonth:Number(at(due).slice(8)),endMode:'after_count',endAfterCount:1}));s.recurringOccurrences.push(matcherOccurrence({id,recurringEntryId:id,originalDueOn:at(due),dueOn:at(due),snoozedUntil:snooze?at(due+snooze):null}));}const report=createPaycheckPlan(s,{asOf:at(0),currency:'USD',periodsLimit:c.limit});const actual=report.periods.map(p=>({startsOn:p.startsOn,endsOn:p.endsOn,income:p.income,dueTotal:p.dueTotal,reservedTotal:p.reservedTotal,obligationTotal:p.obligationTotal,remaining:p.remaining,leading:p.leading,final:p.final,bridge:p.bridge,cashOnHand:p.cashOnHand,cashAfterObligations:p.cashAfterObligations,short:p.short??false,shortfall:p.shortfall??0,items:p.items.map(i=>({id:i.occurrenceId,share:i.share,total:i.remainingTotal,due:i.dueInPeriod})).sort((a,b)=>a.id.localeCompare(b.id)||Number(b.due)-Number(a.due))}));assert.deepEqual(actual,expected[index],`Original paycheck allocation case ${index}: ${JSON.stringify(c)}`);periods+=actual.length;});
console.log(`Matched ${cases.length} original Ruby PaycheckPlanner cases (${periods} complete periods): boundaries, same-day/bridge cash, overdue and snoozed obligations, chronological reserves, shortfalls and exact share conservation.`);
