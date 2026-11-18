import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {tradeCash,validateTrade,investmentAccountBalance,accountPositions} from '../lib/portfolio.ts';import {createHistoricalValuationReader} from '../lib/historical-valuation.ts';import {createPortfolioPerformanceReport} from '../lib/portfolio-performance.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const cases=Array.from({length:600},(_,i)=>({type:i%2?'sweep_out':'sweep_in',currency:['USD','JPY','KWD'][i%3],places:[2,0,3][i%3],qty:String((1+i%19)/4),price:String(4*(1+i%53)),fee:i%43}));
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'set'
class String;def to_d;BigDecimal(self);end;end
class Numeric;def to_d;BigDecimal(to_s);end;end
def methods(path,names)
 text=File.read(path);out={};walk=->(n){if n.is_a?(RubyVM::AbstractSyntaxTree::Node);out[n.children[0]]=text.lines[(n.first_lineno-1)..(n.last_lineno-1)].join if n.type==:DEFN && names.include?(n.children[0]);n.children.each{|c|walk.call(c)};end};walk.call(RubyVM::AbstractSyntaxTree.parse(text));raise 'Missing exact source methods' unless out.length==names.length;out
end
class Trade
 INTERNAL_MOVEMENT_LABELS=['Transfer','Sweep In','Sweep Out'].freeze
 attr_accessor :qty,:price,:fee,:currency,:security,:investment_activity_label
 def initialize(**values);values.each{|k,v|public_send(k.to_s+'=',v)};end
end
methods(File.join(ARGV[0],'app/models/trade.rb'),[:sell?,:internal_movement?,:calculate_realized_gain_loss]).each_value{|s|Trade.class_eval(s)}
Entry=Struct.new(:name,:date,:amount,:currency,:entryable){def id;'entry';end;def save;true;end;def lock_saved_attributes!;end;def trade?;true;end;def transaction?;false;end}
class Entries;def new(**args);Entry.new(**args);end;end
class Account;def entries;Entries.new;end;def sync_later;end;end
Security=Struct.new(:ticker)
class Form
 attr_accessor :account,:date,:qty,:price,:fee,:currency,:type
 def security;Security.new('ABC');end
end
text=File.read(File.join(ARGV[0],'app/models/trade/create_form.rb'));Form.class_eval(text[/SECURITY_TRADE_LABELS = \{.*?\}\.freeze/m]);methods(File.join(ARGV[0],'app/models/trade/create_form.rb'),[:create_trade,:sell_side_trade?,:trade_name]).each_value{|s|Form.class_eval(s)}
Cache=Struct.new(:entry){def get_entries(*);[entry];end}
class CashAccount
 def balance_type;:investment;end
 def asset?;true;end
 def loan?;false;end
end
class Calculator;attr_accessor :account,:sync_cache;end
methods(File.join(ARGV[0],'app/models/balance/base_calculator.rb'),[:derive_cash_balance,:flows_for_date]).each_value{|s|Calculator.class_eval(s)}
methods(File.join(ARGV[0],'app/models/balance/forward_calculator.rb'),[:signed_entry_flows]).each_value{|s|Calculator.class_eval(s)}
class Book
 attr_reader :unknown
 def add_unknown(*,**);@unknown=true;end
 def apply(*,**);end
end
class HoldingCalculator
 def initialize;@transferred_security_ids=Set.new;@lot_books=Hash.new{|h,k|h[k]=Book.new};end
 def effective_trade_price(t,date:);t.price;end
 def unknown;@transferred_security_ids.include?('s');end
end
methods(File.join(ARGV[0],'app/models/holding/forward_calculator.rb'),[:apply_trades]).each_value{|s|HoldingCalculator.class_eval(s)}
class Trade;def security_id;'s';end;end
values=JSON.parse(STDIN.read).map do |c|
 f=Form.new;f.account=Account.new;f.date=Date.new(2026,1,2);f.type=c['type'];f.qty=BigDecimal(c['qty']);f.price=BigDecimal(c['price']);f.currency=c['currency'];factor=10**c['places'];f.fee=BigDecimal(c['fee'].to_s)/factor;e=f.create_trade;t=e.entryable
 raise 'Internal movement not recognized' unless t.internal_movement?;raise 'Source booked realized gain' unless t.calculate_realized_gain_loss.nil?
 calc=Calculator.new;calc.account=CashAccount.new;native=Entry.new(amount:e.amount*factor,entryable:t);calc.sync_cache=Cache.new(native);cash=calc.derive_cash_balance(100000,'2026-01-02');flows=calc.flows_for_date('2026-01-02');h=HoldingCalculator.new;h.apply_trades({'s'=>BigDecimal('20')},[e]);raise 'Inbound movement basis was invented' if t.qty.positive? && !h.unknown
 {qty:t.qty.to_s('F'),cashChange:(-e.amount*factor).to_i,fee:(t.fee*factor).to_i,cash:cash.to_i,label:t.investment_activity_label,flows:flows.transform_values(&:to_i)}
end
puts JSON.generate(values)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:4e6}));for(let i=0;i<cases.length;i++){const c=cases[i],a=actual[i],qty=c.type==='sweep_out'?'-'+c.qty:c.qty,cash=tradeCash(qty,c.price,c.fee,c.currency);assert.equal(cash,a.cashChange,`source sweep cash ${i}`);assert.equal(a.fee,c.fee);const s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Source',currency:c.currency,revision:0},accounts:[{id:'a',ownerId:'one',name:'Account',type:'investment',currency:c.currency,openingBalance:100000,openingDate:'2026-01-01',archived:0}],securities:[{id:'s',ownerId:'one',ticker:'ABC',name:'Example',exchange:'XNYS',kind:'standard',websiteUrl:null}],holdingSnapshots:[{id:'h',ownerId:'one',accountId:'a',securityId:'s',date:'2026-01-01',qty:'20',price:c.price,amount:20*Number(c.price)*10**c.places,currency:c.currency,costBasis:c.price,costBasisSource:'manual',costBasisLocked:1,securityLocked:0}],trades:[{id:'t',ownerId:'one',accountId:'a',securityId:'s',date:'2026-01-02',name:'Sweep',qty,price:c.price,fee:c.fee,cashAmount:cash,currency:c.currency,activity:c.type,sequence:1,notes:'',importKey:null}]};validateTrade(s.trades[0]);const b=investmentAccountBalance(s.accounts[0],s,'2026-01-02');assert.equal(b.cash,a.cash);const p=accountPositions(s,s.accounts[0],'2026-01-02')[0];assert.equal(p.disposals.length,0);if(c.type==='sweep_in')assert.equal(p.cost,null);assert.equal(createHistoricalValuationReader(s,'2026-01-02').read('a','2026-01-02').cash,a.cash);const performance=createPortfolioPerformanceReport(s,{currency:c.currency,from:'2026-01-02',to:'2026-01-02',asOf:'2026-01-02'});assert.equal(performance.marketChange,c.fee===0?0:-c.fee);assert.equal(a.flows.cash_inflows-a.flows.cash_outflows,cash);}
console.log('PASS 600 sweep-in/out scenarios across USD/JPY/KWD, exact pinned Trade::CreateForm amount/sign/fee paths, Balance forward cash/flow methods, Trade internal/no-realized-gain methods and Holding apply_trades inbound-unknown markers. Port actual/indexed cash and recorded performance agree. Controlled account/entry/cache/lot-book adapters are used; full Rails SQL, provider sync and lot accounting are not claimed.');
