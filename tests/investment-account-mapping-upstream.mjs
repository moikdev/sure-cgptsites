import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,parseMoney} from '../lib/finance.ts';import {toCSV} from '../lib/csv.ts';import {investmentImportRows} from '../lib/investment-csv.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const fixtures=[];for(const qty of ['1','-1','0.29','-0.29'])fixtures.push({accounts:[{name:'US',currency:'USD'},{name:'Japan',currency:'JPY'}],mappings:[{source:'US alias',name:'US'},{source:'JP alias',name:'Japan'}],rows:[{account:'US alias',currency:'USD',qty,price:'1',name:'US trade'},{account:'JP alias',currency:'JPY',qty:'2',price:'150',name:'JP trade'}]});
fixtures.push({accounts:[{name:'Shared',currency:'USD'}],mappings:[{source:'One',name:'Shared'},{source:'Two',name:'Shared'}],rows:[{account:'One',currency:'USD',qty:'1',price:'2',name:'Same'},{account:'Two',currency:'USD',qty:'1',price:'2',name:'Same'}]});fixtures.push({accounts:[{name:'Blank target',currency:'USD'}],mappings:[{source:'',name:'Blank target'}],rows:[{account:'',currency:'USD',qty:'3',price:'2',name:'Blank'}]});fixtures.push({accounts:[],mappings:[{source:'New manual',name:'New manual',create:true}],rows:[{account:'New manual',currency:'USD',qty:'1',price:'100',name:'First trade'}]});
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal/util'
class Object;def blank?;respond_to?(:empty?) ? empty? : !self;end;def present?;!blank?;end;def presence;present? ? self : nil;end;end
class String;def blank?;strip.empty?;end;end
class Import
 attr_accessor :account,:family,:mappings,:rows
 def transaction;yield;end
 def type;'TradeImport';end
 def signage_convention;'inflows_positive';end
 def date_format;'%Y-%m-%d';end
 class Row;attr_accessor :import,:qty,:price,:date,:name,:currency,:account,:ticker,:exchange_operating_mic;end
end
row_source=File.read(File.join(ARGV[0],'app/models/import/row.rb'));%w[date_iso signed_amount].each{|name|Import::Row.class_eval(row_source[/  def #{name}\n.*?\n  end/m])};Import::Row.class_eval(row_source[/    def apply_trade_signage_convention\(value\)\n.*?\n    end/m])
Account=Struct.new(:name,:currency,:balance,:import,:accountable)
class Accounts
 attr_reader :rows
 def initialize(rows);@rows=rows.map{|r|Account.new(r['name'],r['currency'],0)};end
 def create_or_find_by!(name:);old=rows.find{|r|r.name==name};return old if old;a=Account.new(name);yield a;rows<<a;a;end
end
class Depository;end
class Mapping
 attr_accessor :key,:import,:mappable,:creatable
 def creatable?;creatable;end
 def save!;end
end
Mapping.class_eval(File.read(File.join(ARGV[0],'app/models/import/account_mapping.rb'))[/  def create_mappable!\n.*?\n  end/m])
class Mappings<Array
 def accounts;self;end
 def mappable_for(key);find{|m|m.key==key}.mappable;end
end
class Security
 @@calls=0
 def self.calls;@@calls;end
 class Resolver
  def initialize(ticker,exchange_operating_mic:);@ticker=ticker;@exchange=exchange_operating_mic;end
  def resolve;Security.class_variable_set(:@@calls,Security.calls+1);Struct.new(:ticker,:exchange).new(@ticker,@exchange);end
 end
end
class Entry;attr_reader :attrs;def initialize(**attrs);@attrs=attrs;end;end
class Trade
 attr_reader :attrs
 def initialize(**attrs);@attrs=attrs;end
 def self.import!(rows,recursive:);@saved=rows;end
 def self.saved;@saved;end
end
load File.join(ARGV[0],'app/models/trade_import.rb')
result=JSON.parse(STDIN.read).map do |f|
 pool=Accounts.new(f['accounts']);m=TradeImport.new;m.family=Struct.new(:accounts,:currency).new(pool,'USD');m.mappings=Mappings.new
 f['mappings'].each{|input|v=Mapping.new;v.key=input['source'];v.import=m;v.creatable=input['create'];v.mappable=pool.rows.find{|a|a.name==input['name']};m.mappings<<v}
 m.rows=f['rows'].map{|r|v=Import::Row.new;r.each{|k,value|v.public_send(k+'=',value)};v.import=m;v.date='2026-02-01';v.ticker='ABC';v.exchange_operating_mic='XNYS';v}
 before=Security.calls;m.import!;{trades:Trade.saved.map{|t|a=t.attrs;e=a[:entry].attrs;{account:e[:account].name,currency:a[:currency],qty:a[:qty],cash:e[:amount].to_s('F'),activity:a[:investment_activity_label].downcase}},accounts:pool.rows.map{|a|{name:a.name,currency:a.currency,balance:a.balance}},resolver_calls:Security.calls-before}
end
puts JSON.generate(result)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(fixtures),encoding:'utf8'}));let checks=0;
for(const [i,f] of fixtures.entries()){const accounts=f.accounts.map(a=>({...a,id:crypto.randomUUID(),ownerId:'one',type:'investment',openingBalance:0,openingDate:'2026-01-01',archived:0})),s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Pinned',currency:'USD',revision:0},accounts,securities:[{id:'s',ownerId:'one',ticker:'ABC',exchange:'XNYS',name:'Example',kind:'standard',websiteUrl:null}]},creations=f.mappings.filter(m=>m.create).map(m=>({id:crypto.randomUUID(),name:m.name,type:'investment',currency:'USD'})),csv=toCSV([['date','ticker','qty','price','currency','account','name'],...f.rows.map(r=>['2026-02-01','ABC',Number(r.qty),r.price,r.currency,r.account,r.name])]),p=await investmentImportRows(s,{kind:'trades',accountId:null,currency:'USD',csv,requestId:crypto.randomUUID(),accountMappings:f.mappings.map(m=>({sourceName:m.source,accountId:accounts.find(a=>a.name===m.name)?.id??creations.find(c=>c.name===m.name).id})),...(creations.length?{accountCreations:creations}:{})}),all=[...accounts,...p.newAccounts];checks++;assert.equal(p.trades.length,actual[i].trades.length);for(let j=0;j<p.trades.length;j++){checks++;assert.equal(all.find(a=>a.id===p.trades[j].accountId).name,actual[i].trades[j].account);checks++;assert.equal(p.trades[j].cashAmount,-parseMoney(actual[i].trades[j].cash.replace(/\.0+$/,''),p.trades[j].currency));checks++;assert.equal(p.trades[j].activity,actual[i].trades[j].activity);}checks++;assert.equal(actual[i].resolver_calls,1);if(creations.length){checks++;assert.equal(actual[i].accounts[0].balance,p.newAccounts[0].openingBalance);}}
console.log(`${checks} pinned Ruby TradeImport, AccountMapping creation, signed cash and activity comparisons passed (actual methods with persistence/security-resolver stubs; not full Rails SQL or provider resolution).`);
