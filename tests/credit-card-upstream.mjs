import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,reportingTransactions} from '../lib/finance.ts';import {creditCardTermsSchema} from '../lib/credit-card-schema.ts';import {cardCycleDates,createCardStatement} from '../lib/credit-card-statement.ts';import {matcherEntry,matcherOccurrence} from './fixtures/recurring-matcher.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const calendar=[];for(const asOf of ['1900-01-01','2024-02-29','2026-02-28','2026-03-01','2026-10-16','2026-10-31'])for(let close=1;close<=31;close++)for(let due=0;due<=31;due++)calendar.push({asOf,close,due:due||null});
const cases=[],states=[];for(let i=0;i<720;i++){const currency=['USD','JPY','KWD'][i%3],precision={USD:2,JPY:0,KWD:3}[currency],asOf=['2026-10-16','2026-10-26','2026-10-27','2024-03-01'][i%4],terms=creditCardTermsSchema.parse({statementCloseDay:1+i%31,dueDay:i%7===0?null:1+(i*7)%31,apr:i%11===0?null:['0','6','12','18.99','600'][i%5],minimumPayment:i%9===0?null:50+i%200}),s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Source',currency,revision:0},accounts:[{id:'card',ownerId:'one',name:'Card',type:'credit',currency,openingBalance:i%8===0?500:-((i*431)%40000),openingDate:'2020-01-01',archived:i%2,creditCardTerms:terms},{id:'cash',ownerId:'one',name:'Cash',type:'checking',currency,openingBalance:100000,openingDate:'2020-01-01',archived:0}]};
 for(let j=0;j<12;j++)s.transactions.push({id:'t'+j,ownerId:'one',accountId:'card',categoryId:null,date:['2024-02-10','2024-02-29','2026-09-01','2026-09-28','2026-10-01','2026-10-10','2026-10-12','2026-10-16','2026-10-26','2026-10-27','2026-10-31','2026-11-01'][j],name:'Entry',amount:j%3===i%3?((i*101+j*13)%5000):-((i*31+j*7)%8000),kind:j%2?'cc_payment':'one_time',excluded:j%2,transferId:null,notes:'',importKey:null});
 if(i%5===0){const t=s.transactions[6];s.splitLines=[{id:'l1',ownerId:'one',transactionId:t.id,position:0,name:'Charge',amount:t.amount-200,categoryId:null,merchantId:null,tagIds:[],notes:'',kind:'standard',excluded:0},{id:'l2',ownerId:'one',transactionId:t.id,position:1,name:'Credit',amount:200,categoryId:null,merchantId:null,tagIds:[],notes:'',kind:'standard',excluded:0}];}
 states.push(s);cases.push({asOf,close:terms.statementCloseDay,due:terms.dueDay,apr:terms.apr,minimum:terms.minimumPayment,currency,precision,entries:[{date:s.accounts[0].openingDate,amount:-s.accounts[0].openingBalance},...reportingTransactions(s).map(t=>({date:t.date,amount:-t.amount}))]});}
const schedules=[];for(let i=0;i<100;i++){const s=structuredClone(states[i]),series=[];for(let j=0;j<4;j++){const id='p'+j,active=j!==3,rows=[{id:id+'a',due:'2026-09-01',effective:i%2?'2026-11-01':'2026-09-01',status:j===2?'paid':'scheduled'},{id:id+'b',due:'2026-10-01',effective:'2026-10-01',status:'scheduled'}];s.recurringEntries.push(matcherEntry({id,accountId:'cash',destinationAccountId:'card',billType:'transfer',amount:-10000,currency:s.accounts[0].currency,status:active?'active':'paused'}));for(const o of rows)s.recurringOccurrences.push(matcherOccurrence({id:o.id,recurringEntryId:id,originalDueOn:o.due,dueOn:o.due,snoozedUntil:o.effective===o.due?null:o.effective,status:o.status,currency:s.accounts[0].currency}));series.push({id,active,rows});}schedules.push({series,asOf:cases[i].asOf});states[i].recurringEntries=s.recurringEntries;states[i].recurringOccurrences=s.recurringOccurrences;}
const ruby=String.raw`
require 'date';require 'bigdecimal';require 'json'
module Accountable;end
class ApplicationRecord;attr_accessor :account,:statement_close_day,:due_day,:apr,:minimum_payment;def self.validates(*);end;end
class Object;def present?;!nil?;end;def blank?;nil?;end;end
class Date;def prev_month;self << 1;end;def next_month;self >> 1;end;def end_of_month;Date.new(year,month,-1);end;end
Currency=Struct.new(:iso_code,:default_precision)
class Money
 include Comparable
 attr_reader :amount,:currency
 def initialize(amount,currency);@amount=BigDecimal(amount.to_s);@currency=currency.is_a?(Currency) ? currency : $currency;end
 def <=>(other);amount <=> other.amount;end
 def positive?;amount.positive?;end
 def zero?;amount.zero?;end
end
class Entries
 def initialize(rows);@rows=rows;end
 def excluding_pending;self;end;def excluding_split_parents;self;end
 def where(filters);return Entries.new(@rows.select{|r|filters=='amount < 0' ? r[:amount].negative? : r[:amount].positive?}) if filters.is_a?(String);Entries.new(@rows.select{|r|filters.all?{|k,v|v.is_a?(Range) ? v.cover?(r[k]) : r[k]==v}});end
 def count;@rows.length;end;def pluck(key);@rows.map{|r|r[key]};end
 def sum(key);pluck(key).reduce(BigDecimal('0'),:+);end
end
class Payments
 include Enumerable
 def initialize(rows);@rows=rows;end
 def each(&block);@rows.each(&block);end
 def where(*);self;end;def active;Payments.new(@rows.select(&:active));end;def includes(*);self;end
end
class RecurringTransaction;def self.accessible_by(_);Payments.new($payments || []);end;end
Occurrence=Struct.new(:due_on,:effective_due_on,:status){def scheduled?;status=='scheduled';end}
Payment=Struct.new(:id,:active,:recurring_occurrences,:next_expected_date)
load File.join(ARGV[0],'app/models/credit_card.rb')
input=JSON.parse(STDIN.read)
calendar=input['calendar'].map{|c|a=CreditCard.new;a.account=Object.new;a.statement_close_day=c['close'];a.due_day=c['due'];date=Date.parse(c['asOf']);last=a.last_statement_close_date(as_of:date);{lastClose:last.to_s,previousClose:a.previous_statement_close_date(as_of:date).to_s,nextClose:a.next_statement_close_date(as_of:date).to_s,lastDue:a.payment_due_date_for(last)&.to_s,followingDue:a.payment_due_date_for(a.next_statement_close_date(as_of:date))&.to_s}}
summaries=input['cases'].map do |c|
 $currency=Currency.new(c['currency'],c['precision']);scale=10**c['precision'];a=CreditCard.new;a.statement_close_day=c['close'];a.due_day=c['due'];a.apr=c['apr'] ? BigDecimal(c['apr']) : nil;a.minimum_payment=c['minimum'] ? BigDecimal(c['minimum'].to_s)/scale : nil
 entries=c['entries'].map{|r|{date:Date.parse(r['date']),amount:BigDecimal(r['amount'].to_s)/scale,currency:c['currency']}};a.account=Struct.new(:id,:currency,:entries).new('card',c['currency'],Entries.new(entries));$payments=[];asof=Date.parse(c['asOf']);summary=a.statement_summary(as_of:asof,viewer:'one');money=->(m){m ? (m.amount*scale).to_i.to_s : nil}
 {balance:money.call(summary.balance),remaining:money.call(summary.remaining),charges:money.call(summary.charges),credits:money.call(summary.credits),accrued:money.call(summary.accrued),interest:money.call(summary.estimated_interest),status:summary.status.to_s,due:summary.due_date&.to_s,lastDue:summary.last_due_date&.to_s,nextClose:summary.next_close.to_s,days:a.days_until_due(as_of:asof),minimum:a.minimum_payment_shortfall?(as_of:asof),rate:summary.monthly_rate&.round(8)&.to_s('F')}
end
schedules=input['schedules'].map{|c|$payments=c['series'].map{|s|Payment.new(s['id'],s['active'],s['rows'].map{|r|Occurrence.new(Date.parse(r['due']),Date.parse(r['effective']),r['status'])},Date.parse('2026-12-01'))};a=CreditCard.new;a.account=Struct.new(:id).new('card');p=a.send(:next_scheduled_payment,as_of:Date.parse(c['asOf']),viewer:'one');{id:p.payment.id,due:p.due_date.to_s}}
puts JSON.generate({calendar:calendar,summaries:summaries,schedules:schedules})
`;
const source=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify({calendar,cases,schedules}),encoding:'utf8',maxBuffer:8e6}));for(let i=0;i<calendar.length;i++){const c=calendar[i];assert.deepEqual(cardCycleDates(c.close,c.due,c.asOf),source.calendar[i]);}
for(let i=0;i<cases.length;i++){const r=createCardStatement(states[i],'card',cases[i].asOf),o=source.summaries[i];for(const [a,b] of [['balance',r.closingDebt?.exact],['remaining',r.summary?.remainingExact],['charges',r.charges?.exact],['credits',r.credits?.exact],['accrued',r.accrued?.exact],['interest',r.interest.exact],['status',r.summary?.status],['due',r.summary?.dueDate],['lastDue',r.dates?.lastDue],['nextClose',r.dates?.nextClose],['days',r.summary?.daysUntilDue],['minimum',r.minimumPaymentShortfall]])assert.equal(b,o[a],`source case ${i} ${a}`);if(o.rate!==null)assert.equal(Number(r.interest.monthlyRate.percent),Number(o.rate));}
for(let i=0;i<schedules.length;i++){const r=createCardStatement(states[i],'card',cases[i].asOf).nextScheduled;assert.deepEqual({id:r.recurringEntryId,due:r.dueDate},source.schedules[i]);}
console.log(`PASS ${calendar.length} calendars, ${cases.length} normalized ledger summaries (USD/JPY/KWD, carry, splits, status/due/interest/minimum), ${schedules.length} stored-payment selections against actual pinned CreditCard methods. Controlled relation/Money adapters, no Rails SQL; raw valuation-entry sums, provider logic and unavailable cached hints excluded. Observation and derived-schedule adaptations verified independently.`);
