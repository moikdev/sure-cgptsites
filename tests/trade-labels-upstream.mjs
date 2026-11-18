import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {convertForeignTrade} from '../lib/investment-fx.ts';import {accountPositions} from '../lib/portfolio.ts';import {TRADE_SOURCE_LABELS} from '../lib/trade-activity.ts';import {INVESTMENT_ACTIVITY_LABELS} from '../lib/investment-reporting-schema.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const cases=Array.from({length:600},(_,i)=>({activity:['contribution','withdrawal','exchange','other'][i%4],currency:['USD','JPY','KWD'][i%3],places:[2,0,3][i%3],foreign:i%2===0,price:10+i%41,outPrice:20+i%47,qty:2+i%5,fee:2*(i%3),outFee:i%3,rate:i%2===0?'1.5':'1'}));
const ruby=String.raw`
require 'json';require 'bigdecimal';require 'date'
class String;def to_d;BigDecimal(self);end;end
class Numeric;def to_d;BigDecimal(to_s);end;end
class NilClass;def to_d;BigDecimal('0');end;end
class Currency<Struct.new(:iso_code);end
class Money
 class ConversionError<StandardError;end
 attr_reader :amount,:currency
 def initialize(n,c);@amount=n.to_d;@currency=c.is_a?(Currency) ? c : Currency.new(c);end
 def *(q);Money.new(amount*q,currency);end
 def -(o);Money.new(amount-o.amount,currency);end
 def exchange_to(c,date:,custom_rate:);Money.new(amount*(currency.iso_code==c ? 1 : custom_rate.to_d),c);end
end
class Trend;attr_reader :current,:previous;def initialize(current:,previous:);@current=current;@previous=previous;end;end
class Holding<Struct.new(:avg_cost,:currency);end
class Trade
 INTERNAL_MOVEMENT_LABELS=['Transfer','Sweep In','Sweep Out']
 attr_accessor :qty,:price,:fee,:currency,:investment_activity_label,:entry,:basis,:rate
 def price_money;Money.new(price,currency);end
 def fee_money;Money.new(fee,currency);end
 def exchange_rate;rate;end
 def basis_holding;basis;end
 def preloaded_rate(*);rate.to_d;end
end
class Calculator;attr_accessor :account;end
Account=Struct.new(:currency);Entry=Struct.new(:date)
def methods(path,names)
 text=File.read(path);out={};walk=->(n){if n.is_a?(RubyVM::AbstractSyntaxTree::Node);out[n.children[0]]=text.lines[(n.first_lineno-1)..(n.last_lineno-1)].join if n.type==:DEFN && names.include?(n.children[0]);n.children.each{|c|walk.call(c)};end};walk.call(RubyVM::AbstractSyntaxTree.parse(text));raise 'Missing pinned methods' unless out.size==names.size;out
end
methods(File.join(ARGV[0],'app/models/trade.rb'),[:sell?,:internal_movement?,:calculate_realized_gain_loss,:converted_to_basis_currency]).each_value{|s|Trade.class_eval(s)}
methods(File.join(ARGV[0],'app/models/holding/trade_calculator_helpers.rb'),[:effective_trade_price,:converted_trade_price,:converted_trade_fee,:convert_to_account_currency]).each_value{|s|Calculator.class_eval(s)}
text=File.read(File.join(ARGV[0],'app/models/transaction.rb'));labels=eval(text[/ACTIVITY_LABELS = \[.*?\]\.freeze/m].sub('ACTIVITY_LABELS = ',''))
values=JSON.parse(STDIN.read).map do |c|
 t=Trade.new;t.qty=c['qty'].to_d;t.price=c['price'].to_d;t.fee=c['fee'].to_d;t.currency=c['foreign'] ? 'EUR' : c['currency'];t.rate=c['rate'];t.investment_activity_label=c['activity'].capitalize;t.entry=Entry.new(Date.new(2026,1,2));calc=Calculator.new;calc.account=Account.new(c['currency']);avg=calc.effective_trade_price(t,date:t.entry.date);raise 'New source label falsely internal' if t.internal_movement?
 t.qty=BigDecimal('-1');t.price=c['outPrice'].to_d;t.fee=c['outFee'].to_d;t.basis=Holding.new(Money.new(avg,c['currency']),Currency.new(c['currency']));r=t.calculate_realized_gain_loss;raise 'Source did not return priced gain' unless r
 f=10**c['places'];basis=(r.previous.amount*f).round(0,BigDecimal::ROUND_HALF_UP).to_i;proceeds=(r.current.amount*f).round(0,BigDecimal::ROUND_HALF_UP).to_i
 {basis:basis,proceeds:proceeds,gain:proceeds-basis}
end
puts JSON.generate({labels:labels,values:values})
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:4e6}));assert.deepEqual(expected.labels,[...INVESTMENT_ACTIVITY_LABELS]);assert.deepEqual([...new Set(Object.values(TRADE_SOURCE_LABELS))].sort(),expected.labels.toSorted());for(let i=0;i<cases.length;i++){const c=cases[i],sourceCurrency=c.foreign?'EUR':c.currency,factor=sourceCurrency==='JPY'?1:sourceCurrency==='KWD'?1000:100,s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Source',currency:c.currency,revision:0},accounts:[{id:'a',ownerId:'one',name:'Account',type:'investment',currency:c.currency,openingBalance:100000,openingDate:'2026-01-01',archived:0}],securities:[{id:'s',ownerId:'one',ticker:'ABC',name:'Example',exchange:'XNYS',kind:'standard',websiteUrl:null}]};for(const [sequence,qty,price,fee] of [[1,String(c.qty),String(c.price),c.fee*factor],[2,'-1',String(c.outPrice),c.outFee*factor]]){const t={id:'t'+sequence,ownerId:'one',accountId:'a',securityId:'s',date:'2026-01-0'+(sequence+1),name:'Independent cash',qty,price,fee,cashAmount:sequence===1?123:-456,currency:sourceCurrency,activity:c.activity,sequence,notes:'',importKey:null};s.trades.push(c.foreign?{...t,...convertForeignTrade(s,t,c.currency,c.rate)}:t);}const p=accountPositions(s,s.accounts[0],'2026-01-31')[0];assert.deepEqual({basis:p.disposals[0].cost,proceeds:p.disposals[0].proceeds,gain:p.disposals[0].gain},expected.values[i],`priced source ${i}`);}
console.log('PASS all thirteen source labels and 600 native/foreign Contribution/Withdrawal/Exchange/Other scenarios across USD/JPY/KWD executing actual pinned Holding effective-price/fee/conversion and Trade internal/disposal/basis-currency methods. Priced basis/proceeds are independent of booked cash. Money/rate/holding adapters and separate final minor-unit rounding are controlled; full Rails SQL and historical holding selection are not executed.');
await import('./portfolio-flows-upstream.mjs');
