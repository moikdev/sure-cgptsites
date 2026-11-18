import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {planAutomaticTransfers,automaticTransferCandidates} from '../lib/transfer-auto.ts';
const root='/tmp/sure-upstream-port-reference',cases=[];let seed=89;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let n=0;n<600;n++){
 const from=['checking','loan','credit','investment','crypto'][random()%5],to=['checking','loan','credit','investment','crypto','other_liability'][random()%6],category=random()%3?'Purpose':null,source={...structuredClone(emptyState),profile:{ownerId:'one',name:'Oracle',currency:'USD',revision:1},accounts:[{id:'a',ownerId:'one',name:'Source',type:from,currency:'USD',openingBalance:100000,openingDate:'2026-01-01',archived:0},{id:'b',ownerId:'one',name:'Destination',type:to,currency:'USD',openingBalance:0,openingDate:'2026-01-01',archived:0}],categories:category?[{id:'c',ownerId:'one',name:category,color:'#123456'}]:[],transactions:[]};
 for(let i=0;i<4;i++)source.transactions.push({id:'o'+i,ownerId:'one',accountId:'a',categoryId:category?'c':null,date:'2026-02-'+String(1+random()%7).padStart(2,'0'),name:'Original',amount:-10000*(1+random()%3),kind:'standard',transferId:null,notes:'',lockedFields:['name']},{id:'i'+i,ownerId:'one',accountId:'b',categoryId:null,date:'2026-02-'+String(1+random()%7).padStart(2,'0'),name:'Original',amount:10000*(1+random()%3),kind:'standard',transferId:null,notes:'',lockedFields:[]});
 const p=planAutomaticTransfers(source,{operation:'scan'},'2026-03-01'),selected=p.changes.map(c=>[c.outflowTransactionId,c.inflowTransactionId]),confirmed=p.changes.length?planAutomaticTransfers(p.next,{operation:'confirm',transferIds:p.changes.map(c=>c.id)},'2026-03-01'):null;
 cases.push({from,to,category,entries:source.transactions.map(t=>({id:t.id,amount:t.amount,date:t.date})),candidates:automaticTransferCandidates(source),expected:{selected,confirmation:confirmed?confirmed.review.changes.map(c=>({out:c.outflowKindAfter,into:c.inflowKindAfter,category:c.categoryAfter})):[]}});
}
const ruby=String.raw`
require 'json';require 'set'
class Family;end
class ApplicationRecord
 def self.belongs_to(name,**kwargs);attr_accessor name;end
 def self.has_many(*args,**kwargs);end
 def self.enum(*args,**kwargs);end
 def self.validates(*args,**kwargs);end
 def self.validate(*args,**kwargs);end
 def self.before_destroy(*args,**kwargs);end
 def self.transaction(**kwargs);yield;end
end
load File.join(ARGV[0],'app/models/transfer.rb')
load File.join(ARGV[0],'app/models/family/auto_transfer_matchable.rb')
CategoryRow=Struct.new(:name) do
 def present?;true;end
end
class Account
 def initialize(type);@type=type;end
 def loan?;@type=='loan';end
 def credit_card?;@type=='credit';end
 def investment?;@type=='investment';end
 def crypto?;@type=='crypto';end
 def liability?;['loan','credit','other_liability'].include?(@type);end
 def family;self;end
 def investment_contributions_category;CategoryRow.new('Investment Contributions');end
end
class Row
 attr_accessor :kind,:category,:entry
 def initialize(account,category=nil);@kind='standard';@entry=Struct.new(:account).new(account);@category=category;end
 def update!(attrs);attrs.each{|key,value|send(key.to_s+'=',value)};end
 def category_id;category&.name;end
end
class NilClass;def blank?;true;end;end
class String;def blank?;empty?;end;end
class Transfer
 attr_accessor :status
 def update!(attrs);attrs.each{|key,value|send(key.to_s+'=',value)};end
end
Candidate=Struct.new(:outflow_transaction_id,:inflow_transaction_id,:date_diff,:match_rank)
class OracleFamily
 include Family::AutoTransferMatchable
 attr_reader :selected,:flags
 def initialize(candidates);@candidates=candidates;@used=Set.new;@selected=[];end
 def auto_match_transfers_disabled?;false;end
 def transfer_match_candidates(**kwargs);@flags=kwargs;@candidates;end
 def find_or_create_transfer!(match)
  return nil if @used.include?(match.outflow_transaction_id)||@used.include?(match.inflow_transaction_id)
  @used << match.outflow_transaction_id << match.inflow_transaction_id;@selected << [match.outflow_transaction_id,match.inflow_transaction_id]
  Object.new.tap{|o|def o.previously_new_record?;true;end}
 end
 def sync_principal_only_loan_accounts(transfers);end
end
rows=JSON.parse(STDIN.read).map do |c|
 # Independent same-currency SQL predicate from the pinned query, before its greedy method runs.
 entries=c['entries'];out=entries.select{|r|r['amount']<0};into=entries.select{|r|r['amount']>0}
 require 'date'
 candidates=out.flat_map{|o|into.filter_map{|i|diff=(Date.parse(o['date'])-Date.parse(i['date'])).to_i.abs;Candidate.new(o['id'],i['id'],diff,0) if o['amount']==-i['amount']&&diff<=4}}.sort_by{|r|[r.match_rank,r.date_diff,r.outflow_transaction_id,r.inflow_transaction_id]}
 family=OracleFamily.new(candidates);family.auto_match_transfers!
 expected_flags={account_id:nil,include_rejected:false,exchange_rate_tolerance:0.1,restrict_cross_currency_to_linked_accounts:true,require_common_writer:true,exclude_same_wise_item:true}
 raise 'Automatic source scope changed' unless family.flags==expected_flags
 confirmations=family.selected.map do |out_id,in_id|
  t=Transfer.new;t.status='pending';t.outflow_transaction=Row.new(Account.new(c['from']),c['category'] ? CategoryRow.new(c['category']) : nil);t.inflow_transaction=Row.new(Account.new(c['to']));t.confirm!
  raise 'Source confirmation status' unless t.status=='confirmed'
  {out:t.outflow_transaction.kind,into:t.inflow_transaction.kind,category:t.outflow_transaction.category&.name}
 end
 {candidates:candidates.map{|r|{outflowTransactionId:r.outflow_transaction_id,inflowTransactionId:r.inflow_transaction_id,matchRank:r.match_rank,daysApart:r.date_diff}},selected:family.selected,confirmation:confirmations}
end
puts JSON.generate(rows)
`;
const result=spawnSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8_000_000});assert.equal(result.status,0,result.stderr);const rows=JSON.parse(result.stdout);assert.equal(rows.length,cases.length);for(let i=0;i<cases.length;i++){assert.deepEqual(rows[i].candidates,cases[i].candidates,'Original SQL same-currency scope '+i);assert.deepEqual({selected:rows[i].selected,confirmation:rows[i].confirmation},cases[i].expected,'Actual Ruby automatic matching and confirmation '+i);}console.log(`Matched ${cases.length} actual Ruby auto_match_transfers! greedy and Transfer#confirm! cases, independent exact-amount/date candidate predicates and original automatic scope flags. Foreign routes/tolerances remain separately covered by behavioral/API tests.`);
