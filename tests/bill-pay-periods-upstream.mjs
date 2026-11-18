import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {createBillsOverview,createBillsCalendar} from '../lib/bills-workspace.ts';import {matcherState,matcherEntry,matcherOccurrence} from './fixtures/recurring-matcher.ts';
const root=process.argv[2];if(!root)throw new Error('Pass the pinned Sure checkout.');const cases=[],date=(asOf,days)=>new Date(Date.parse(asOf)+days*86400000).toISOString().slice(0,10);
for(const asOf of ['2026-01-01','2026-01-10','2026-01-25','2026-02-27'])for(const frequency of ['weekly','monthly'])for(const first of [0,3])for(const manual of [0,1])for(const closed of [false,true])for(const snooze of [false,true])for(const currency of ['USD','EUR','JPY']){
 const s=matcherState();s.transactions=[];s.recurringEntries=[];s.recurringOccurrences=[];const starts=date(asOf,first),anchorDay=Number(starts.slice(8)),pay=matcherEntry({id:'pay',name:'Paycheck',manual,amount:120000,billType:'income',anchorDate:starts,startsOn:starts,expectedDayOfMonth:anchorDay,endMode:'after_count',endAfterCount:8,rules:frequency==='monthly'?[]:[{frequency:'weekly',interval:1,weekday:new Date(starts).getUTCDay(),dayOfMonth:null,weekdayOrdinal:null,monthOfYear:null}]});s.recurringEntries.push(pay);
 const incomes=[];for(let i=0;i<8;i++){const d=frequency==='weekly'?date(starts,i*7):new Date(Date.UTC(Number(starts.slice(0,4)),Number(starts.slice(5,7))-1+i,anchorDay)).toISOString().slice(0,10);s.recurringOccurrences.push(matcherOccurrence({id:'p'+i,recurringEntryId:'pay',originalDueOn:d,dueOn:d,status:i===0&&closed?'paid':'scheduled'}));if(manual===1&&!(i===0&&closed))incomes.push({id:'p'+i,date:d,amount:120000,currency:'USD'});}
 for(const [i,offset] of [-3,1,5,12,19,26,33,40].entries()){const d=date(asOf,offset),id='b'+i,entry=matcherEntry({id,name:id,anchorDate:d,startsOn:d,expectedDayOfMonth:Number(d.slice(8)),amount:-((i+1)*1000),currency:i%3===0?currency:'USD',endMode:'after_count',endAfterCount:1});s.recurringEntries.push(entry);s.recurringOccurrences.push(matcherOccurrence({id:'o'+i,recurringEntryId:id,originalDueOn:d,dueOn:d,currency:entry.currency,status:i===1?'paid':'scheduled',snoozedUntil:snooze&&i===2?date(d,12):null}));}
 s.exchangeRates=[{id:'q',ownerId:'one',date:asOf,fromCurrency:'EUR',toCurrency:'USD',rate:'2',notes:''}];const report=createBillsOverview(s,{asOf,currency:'USD'}),calendar=createBillsCalendar(s,{asOf,currency:'USD',month:asOf.slice(0,7)});cases.push({state:s,asOf,incomes,report,calendar});
}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'set'
class Object;def present?;!nil?&&self!=false&&(!respond_to?(:empty?)||!empty?);end;def blank?;!present?;end;end
class Date;class << self;attr_accessor :now;def current;now;end;end;def end_of_month;Date.new(year,month,-1);end;end
class ApplicationController;def self.before_action(*);end;def self.helper_method(*);end;end
module RecurringFeatureGuardable;end
module Current;class << self;attr_accessor :family;def user;nil;end;end;end
class Money
 class ConversionError<StandardError;end
 attr_reader :amount,:currency
 def initialize(amount,currency='USD');@amount=BigDecimal(amount.to_s);@currency=currency;end
 def exchange_to(to);return self if currency==to;raise ConversionError unless currency=='EUR'&&to=='USD';Money.new(amount*2,to);end
end
require File.join(ARGV[0],'app/models/recurring_transaction/paycheck_planner.rb')
require File.join(ARGV[0],'app/controllers/bills_controller.rb')
require File.join(ARGV[0],'app/helpers/bills_helper.rb')
Family=Struct.new(:currency,:incomes)
Series=Struct.new(:display_name)
Occurrence=Struct.new(:id,:recurring_transaction_id,:due_on,:effective_due_on,:value,:currency,:recurring_transaction) do
 def resolved_expected_amount_money;Money.new(value,currency);end
end
class RecurringTransaction::PaycheckPlanner
 def upcoming_income_occurrences;family.incomes;end
 def open_payable_occurrences(*);[];end
 def cash_on_hand;nil;end
end
helper=Object.new.extend(BillsHelper)
output=JSON.parse(STDIN.read).map do |c|
 Date.now=Date.parse(c['asOf']);incomes=c['incomes'].map { |i| d=Date.parse(i['date']);Occurrence.new(i['id'],'pay',d,d,BigDecimal(i['amount'].to_s)/100,'USD',Series.new('Paycheck')) };Current.family=Family.new('USD',incomes)
 periods=BillsController.new.send(:month_pay_periods,Date.current,Date.current.end_of_month)
 make=->(r) { e=r['entry'];precision=e['currency']=='JPY' ? 1 : 100;Occurrence.new(r['occurrence']['id'],e['id'],Date.parse(r['occurrence']['dueOn']),Date.parse(r['dueOn']),BigDecimal(r['expected'].to_s)/precision,e['currency'],Series.new(e['name'])) }
 rows=c['report']['sections']['month'].map(&make);counted=(c['report']['sections']['month'].select { |r| r['occurrence']['status']=='paid' }+c['report']['sections']['month'].select { |r| r['occurrence']['status']=='scheduled' }+c['upcomingAfterMonth']).map(&make)
 markers=helper.bills_pay_period_markers(rows,periods,currency:'USD',counted:counted)
 {periods:periods.map { |p| {startsOn:p.starts_on.iso8601,endsOn:p.ends_on.iso8601,income:(p.income*100).round.to_i} },markers:markers.map { |id,m| {beforeOccurrenceId:id,startsOn:m[:period].starts_on.iso8601,expected:(m[:due_total]*100).round.to_i} }}
end
STDOUT.write(JSON.generate(output))
`;
// Count every upcoming occurrence, including repeats hidden by the one-per-series Later rail.
const input=cases.map(c=>{const end=c.report.monthEnd;const all=c.state.recurringOccurrences.filter(o=>o.recurringEntryId!=='pay'&&o.status==='scheduled').map(o=>{const e=c.state.recurringEntries.find(e=>e.id===o.recurringEntryId),dueOn=o.snoozedUntil&&o.snoozedUntil>o.dueOn?o.snoozedUntil:o.dueOn;return {entry:e,occurrence:o,dueOn,expected:Math.abs(e.amount)};}).filter(r=>r.dueOn>end&&r.occurrence.dueOn<=c.report.horizon);return {...c,upcomingAfterMonth:all};});
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:20_000_000}));cases.forEach((c,i)=>{assert.deepEqual(c.report.payPeriods.periods.map(p=>({startsOn:p.startsOn,endsOn:p.endsOn,income:p.income.known})),expected[i].periods,'Original month-pay-period gate '+i);assert.deepEqual(c.report.payPeriods.markers.map(m=>({beforeOccurrenceId:m.beforeOccurrenceId,startsOn:m.period.startsOn,expected:m.expected.known})),expected[i].markers,'Original pay-period marker helper '+i);for(const day of c.calendar.days){const rows=c.calendar.rows.filter(r=>r.occurrence.dueOn===day.date);assert.deepEqual(rows.map(r=>r.expected),rows.map(r=>r.expected).sort((a,b)=>b-a),'Original calendar descending native amount '+i);}});console.log(`Matched ${cases.length} original BillsController month-pay-period and BillsHelper marker outcomes using the original PaycheckPlanner: weekly/monthly boundaries, declared/detected income, closed arrivals, snoozes, paid/full expected bills, month-crossing periods and missing/native FX. Calendar ordering also matches.`);
