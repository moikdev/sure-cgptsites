import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {prepareCSVAccountCreations} from '../lib/csv-account-creation.ts';import {emptyState} from '../lib/finance.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const cases=[],options={delimiter:',',dateFormat:'ymd',numberFormat:'decimal-dot',amountMode:'signed',signage:'outflows-negative',columns:{date:0,name:1,amount:2,account:3}};
for(const currency of ['USD','JPY','KWD'])for(const existing of [false,true]){const id=crypto.randomUUID(),state={...structuredClone(emptyState),profile:{ownerId:'one',name:'Pinned',currency,revision:0},accounts:existing?[{id:crypto.randomUUID(),ownerId:'one',name:'Cash',type:'checking',currency,openingBalance:100,openingDate:'2026-01-01',archived:0}]:[]},p=await prepareCSVAccountCreations(state,'d,n,a,acct\n2026-02-01,Entry,1,Source',options,[{sourceName:'Source',accountId:id}],[{id,name:'Cash',currency}],'seed'),a=p.state.accounts.find(a=>a.id===p.mappings[0].accountId);cases.push({currency,existing,expected:{balance:a.openingBalance,currency:a.currency,owned:p.newAccounts.length===1,depository:a.type==='checking'}});}
const ruby=String.raw`
require 'json'
class Depository;end
class SourceAccount
 attr_accessor :balance,:currency,:import,:accountable
end
class Accounts
 def initialize(existing,currency);@existing=existing;if existing;@account=SourceAccount.new;@account.balance=100;@account.currency=currency;@account.accountable=Depository.new;end;end
 def create_or_find_by!(name:);return @account if @existing;@account=SourceAccount.new;yield @account;@account;end
end
class SourceMapping
 attr_accessor :family,:import,:mappable
 def creatable?;true;end
 def key;'Cash';end
 def save!;@saved=true;end
end
create=File.read(File.join(ARGV[0],'app/models/import/account_mapping.rb'))[/  def create_mappable!\n.*?\n  end/m]
raise 'Pinned creation method missing' unless create
SourceMapping.class_eval(create)
Family=Struct.new(:accounts,:currency)
results=JSON.parse(STDIN.read).map do |c|
 m=SourceMapping.new;m.family=Family.new(Accounts.new(c.fetch('existing'),c.fetch('currency')),c.fetch('currency'));m.import=Struct.new(:family).new(m.family);m.create_mappable!;a=m.mappable
 {balance:a.balance,currency:a.currency,owned:a.import.equal?(m.import),depository:a.accountable.is_a?(Depository)}
end
class Import
 def self.transaction;yield;end
end
class SourceImport
 attr_reader :events
 def initialize;@events=[];end
 def accounts;self;end
 def entries;@entries=true;self;end
 def destroy_all;@events << (@entries ? 'entries' : 'accounts');end
 def revert_derived_state!;@events << 'derived';end
 def family;self;end
 def sync_later;@events << 'sync';end
 def status_after_revert;:pending;end
 def update!(attrs);@events << attrs.fetch(:status).to_s;end
end
revert=File.read(File.join(ARGV[0],'app/models/import.rb'))[/  def revert\n.*?\n  end/m]
raise 'Pinned reversal method missing' unless revert
SourceImport.class_eval(revert);i=SourceImport.new;i.revert
puts JSON.generate({accounts:results,revert:i.events})
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8'}));assert.deepEqual(actual.accounts,cases.map(c=>c.expected));assert.deepEqual(actual.revert,['accounts','entries','derived','sync','pending']);console.log('7 pinned Ruby account creation/import reversal method checks passed (association stubs; not full Rails SQL).');
