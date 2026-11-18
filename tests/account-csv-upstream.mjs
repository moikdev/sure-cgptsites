import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {accountCSVOptionsSchema,planAccountCSV} from '../lib/account-csv.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const ruby=String.raw`
require 'json';require 'csv';require 'date';require 'bigdecimal/util'
class Object;def present?;true;end;end
class NilClass;def present?;false;end;end
class String;def present?;!strip.empty?;end;def constantize;Object.const_get(self);end;end
class Depository;end;class CreditCard;end;class Loan;end;class Investment;end;class Crypto;end;class Property;end;class Vehicle;end;class OtherAsset;end;class OtherLiability;end
class Import
 attr_accessor :rows,:family,:mappings,:date_format
 def transaction;yield;end
end
class Account
 attr_accessor :name,:balance,:currency,:accountable,:opening_balance,:opening_date,:import
 def initialize(pool,attrs);@pool=pool;attrs.each{|key,value|send(key.to_s+'=',value)};end
 def save!;@pool.rows<<self;end
 class OpeningBalanceManager
  def initialize(account);@account=account;end
  def set_opening_balance(balance:,date:);@account.opening_balance=balance;@account.opening_date=date;Struct.new(:error).new(nil);end
 end
end
class Pool
 attr_accessor :rows
 def initialize;@rows=[];end
 def build(**attrs);Account.new(self,attrs);end
end
class Mappings
 def initialize(type);@type=type;end
 def account_types;self;end
 def find_by(key:);Struct.new(:value).new(@type);end
end
load File.join(ARGV[0],'app/models/account_import.rb')
input=JSON.parse(STDIN.read);results=input.map do |f|
 pool=Pool.new;import=AccountImport.new;import.family=Struct.new(:accounts).new(pool);import.mappings=Mappings.new(f.fetch('class'));import.date_format='%Y-%m-%d';import.rows=f.fetch('rows').map{|r|Struct.new(:entity_type,:name,:amount,:currency,:date).new(r['type'],r['name'],r['balance'],r['currency'],r['date'])};import.import!
 {accounts:pool.rows.map{|a|{name:a.name,balance:a.balance.to_s('F'),currency:a.currency,date:a.opening_date&.iso8601,kind:a.accountable.class.name}},max:import.max_row_count}
end
puts JSON.generate({results:results,template:AccountImport.new.csv_template.to_csv})
`;
const kinds=[['Depository','checking'],['CreditCard','credit'],['Loan','loan'],['Investment','investment'],['Crypto','crypto'],['Property','property'],['Vehicle','vehicle'],['OtherAsset','other'],['OtherLiability','other_liability']],fixtures=kinds.map(([klass])=>({class:klass,rows:[{type:'Source',name:'Repeated',balance:'100.25',currency:'USD',date:'2026-01-01'},{type:'Source',name:'Repeated',balance:'-50.50',currency:'USD',date:'2026-01-02'}]})),actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(fixtures),encoding:'utf8'}));let checks=0;
for(let i=0;i<fixtures.length;i++){const f=fixtures[i],csv='type,name,balance,currency,date\n'+f.rows.map(r=>[r.type,r.name,r.balance,r.currency,r.date].join(',')).join('\n'),state={...structuredClone(emptyState),profile:{ownerId:'one',name:'Pinned',currency:'USD',revision:0}},p=await planAccountCSV(csv,accountCSVOptionsSchema.parse({}),[{sourceName:'Source',type:kinds[i][1]}],state,'seed','2026-02-01');checks++;assert.equal(actual.results[i].max,50);checks++;assert.equal(p.accounts.length,actual.results[i].accounts.length);for(let j=0;j<2;j++){const source=actual.results[i].accounts[j],target=p.accounts[j],native=Number(source.balance)*100*(['credit','loan','other_liability'].includes(target.type)?-1:1);checks++;assert.equal(target.openingBalance,native);checks++;assert.equal(target.openingDate,source.date);checks++;assert.equal(target.name,source.name);}}
const state={...structuredClone(emptyState),profile:{ownerId:'one',name:'Template',currency:'USD',revision:0}},template=await planAccountCSV(actual.template,accountCSVOptionsSchema.parse({}),[{sourceName:'Checking',type:'checking'},{sourceName:'Savings',type:'savings'},{sourceName:'Credit Card',type:'credit'}],state,'template','2026-02-01');checks++;assert.equal(template.total,3);checks++;assert.equal(template.accounts[2].openingBalance,50000);console.log(`${checks} pinned Ruby AccountImport creation, duplicate-name, anchor-date and template checks passed (actual import method with persistence/opening-manager stubs; not full Rails SQL).`);
