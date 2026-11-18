import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {KINDS,ACCOUNT_TYPES} from '../lib/finance.ts';import {repairState,addRepairPair} from './fixtures/transfer-repair.ts';import {planInvestmentTransferRepair,TRANSFER_REPORTING_KINDS} from '../lib/transfer-kind-repair.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference',cases=[];let seed=137;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>8;};
for(let n=0;n<1600;n++){const s=repairState(),from=ACCOUNT_TYPES[random()%ACCOUNT_TYPES.length],to=ACCOUNT_TYPES[random()%ACCOUNT_TYPES.length];s.accounts[0].type=from;s.accounts[1].type=to;s.accounts[0].archived=random()%2;s.accounts[1].excludedFromReports=random()%2;s.profile.autoTransferDisabled=random()%2;const {out,into}=addRepairPair(s,'pair',10000,{outKind:KINDS[random()%KINDS.length],inKind:KINDS[random()%KINDS.length],status:random()%2?'pending':'confirmed'});for(const t of [out,into]){t.excluded=random()%2;t.lockedFields=random()%2?['kind','name']:['name'];}const p=planInvestmentTransferRepair(s,{},'2026-03-31');cases.push({from,to,pending:s.transferDetails[0].status==='pending',out:{kind:out.kind,excluded:!!out.excluded,locked:out.lockedFields.includes('kind')},into:{kind:into.kind,excluded:!!into.excluded,locked:into.lockedFields.includes('kind')},expected:{checked:p.review.checked,changed:Object.fromEntries(p.review.transitions.map(t=>[t.transition,t.count])),kinds:p.next.transactions.map(t=>t.kind),mutated:p.next.transactions.map((t,i)=>t.kind!==s.transactions[i].kind)}});}
// Include decisive eligible, protected, excluded, chosen-kind and pending cases independently of random coverage.
for(const from of ['checking','investment','crypto'])for(const to of ['investment','crypto'])for(const kind of KINDS){const s=repairState();s.accounts[0].type=from;s.accounts[1].type=to;const {out,into}=addRepairPair(s,'pair',10000,{outKind:kind,inKind:kind,status:'pending'}),p=planInvestmentTransferRepair(s,{},'2026-03-31');cases.push({from,to,pending:true,out:{kind:out.kind,excluded:false,locked:false},into:{kind:into.kind,excluded:false,locked:false},expected:{checked:p.review.checked,changed:Object.fromEntries(p.review.transitions.map(t=>[t.transition,t.count])),kinds:p.next.transactions.map(t=>t.kind),mutated:p.next.transactions.map((t,i)=>t.kind!==s.transactions[i].kind)}});}
assert.ok(cases.some(c=>c.expected.mutated.every(Boolean)));assert.ok(cases.some(c=>c.expected.checked===0));assert.ok(cases.some(c=>c.pending&&c.expected.mutated.some(Boolean)));
const ruby=String.raw`
require 'json'
class ApplicationRecord
 def self.belongs_to(name,**kwargs);attr_accessor name;end
 def self.has_many(*args,**kwargs);end
 def self.enum(*args,**kwargs);end
 def self.validates(*args,**kwargs);end
 def self.validate(*args,**kwargs);end
 def self.before_destroy(*args,**kwargs);end
end
class Time;def self.current;Time.utc(2026,3,31);end;end
class Account
 attr_reader :type
 def initialize(type);@type=type;end
 def present?;true;end
 def loan?;type=='loan';end
 def credit_card?;type=='credit';end
 def investment?;type=='investment';end
 def crypto?;type=='crypto';end
 def liability?;['loan','credit','other_liability'].include?(type);end
 def accountable_type;{'investment'=>'Investment','crypto'=>'Crypto'}.fetch(type,'Other');end
end
class Entry
 attr_reader :account,:updated
 def initialize(account,excluded);@account=account;@excluded=excluded;@updated=false;end
 def excluded?;@excluded;end
 def update_columns(**attrs);@updated=true;end
end
class Row
 attr_reader :id,:entry,:updated
 attr_accessor :kind
 def initialize(id,input,account);@id=id;@kind=input['kind'];@locked=input['locked'];@entry=Entry.new(account,input['excluded']);@updated=false;end
 def locked?(key);key==:kind&&@locked;end
 def update_columns(**attrs);@kind=attrs.fetch(:kind);@updated=true;end
end
class Transaction
 TRANSFER_KINDS=File.read(File.join(ARGV[0],'app/models/transaction.rb'))[/TRANSFER_KINDS = %w\[(.*?)\]/m,1].split.freeze
 def self.transaction;yield;end
end
load File.join(ARGV[0],'app/models/transfer.rb')
class Transfer;def inflow_transaction_id;inflow_transaction.id;end;end
load File.join(ARGV[0],'app/models/transfer/investment_kind_reconciler.rb')
class Scope
 def initialize(rows);@rows=rows;end
 def joins(**kwargs);raise 'Unexpected destination join' unless kwargs=={inflow_transaction:{entry: :account}};self;end
 def where(**kwargs);types=kwargs.fetch(:accounts).fetch(:accountable_type);Scope.new(@rows.select{|t|types.include?(t.to_account.accountable_type)});end
 def includes(**kwargs);self;end
 def find_each;@rows.each{|r|yield r};end
end
rows=JSON.parse(STDIN.read).map do |c|
 t=Transfer.new;t.outflow_transaction=Row.new('out',c['out'],Account.new(c['from']));t.inflow_transaction=Row.new('in',c['into'],Account.new(c['to']));scope=Scope.new([t]);before=[t.outflow_transaction.kind,t.inflow_transaction.kind]
 dry=Transfer::InvestmentKindReconciler.new(scope:scope,dry_run:true).run
 raise 'Dry run changed original kinds' unless before==[t.outflow_transaction.kind,t.inflow_transaction.kind]
 actual=Transfer::InvestmentKindReconciler.new(scope:scope).run
 raise 'Dry run differs from commit' unless dry.checked==actual.checked&&dry.changed==actual.changed
 second=Transfer::InvestmentKindReconciler.new(scope:scope).run
 raise 'Repair is not idempotent' unless second.changed.empty?
 entries=[t.outflow_transaction,t.inflow_transaction];raise 'Source entry clocks were not refreshed' unless entries.all?{|r|r.updated==r.entry.updated}
 {checked:actual.checked,changed:actual.changed,kinds:entries.map(&:kind),mutated:entries.map(&:updated)}
end
puts JSON.generate({kinds:Transaction::TRANSFER_KINDS,rows:rows})
`;
const result=spawnSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8_000_000});assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);assert.deepEqual(actual.kinds.slice().sort(),Array.from(TRANSFER_REPORTING_KINDS).sort());assert.equal(actual.rows.length,cases.length);for(let i=0;i<cases.length;i++)assert.deepEqual(actual.rows[i],cases[i].expected,'Actual Ruby InvestmentKindReconciler case '+i);console.log(`Matched ${cases.length} actual Ruby Transfer::InvestmentKindReconciler cases, destination and kind constants, per-leg exclusions/protections, dry-run/commit parity, cache invalidation and idempotence, including preclassified pending pairs.`);
