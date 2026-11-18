import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {planMerchantMerge} from '../lib/merchant-merge.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const cases=Array.from({length:300},(_,i)=>{const sourceIds=Array.from({length:1+i%4},(_,j)=>'source'+j),ids=['keep',...sourceIds,'unrelated'],currency=['USD','JPY','KWD'][i%3],s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Merge',currency,revision:0},accounts:[{id:'a',ownerId:'one',name:'Account',type:'checking',currency,openingBalance:10000,openingDate:'2020-01-01',archived:i%2}],merchants:ids.map(id=>({id,ownerId:'one',name:id,color:'#112233',websiteUrl:null}))};s.transactions=Array.from({length:40},(_,j)=>({id:'t'+j,ownerId:'one',accountId:'a',categoryId:null,date:'2026-01-01',name:'Transaction '+j,amount:j%5?j%2?-123:456:0,kind:'standard',transferId:null,merchantId:j%7===0?null:ids[j%ids.length],notes:'Keep',importKey:null,lockedFields:[]}));const base={ownerId:'one',active:1,group:'Kept',effectiveDate:null,currency:null,stopProcessing:0,blockedReason:null,sourceJson:null};s.rules=[{...base,id:'r1',name:'Simple',position:1,conditions:[{field:'merchantId',operator:'=',value:sourceIds[0].toUpperCase()}],actions:[{type:'merchantId',value:sourceIds.at(-1)}]},{...base,id:'r2',name:'Compound',position:2,conditions:[{field:'group',operator:i%2?'and':'or',conditions:[{field:'merchantId',operator:'!=',value:sourceIds[0]},{field:'merchantId',operator:'is_null',value:sourceIds[0]}]}],actions:[{type:'merchantId',value:'unrelated'}]}];return {sourceIds:i%2?[...sourceIds,'keep']:sourceIds,state:s};});
const ruby=String.raw`
require 'json'
module ActiveRecord;class Relation;end;end
class Time;def self.current;Time.now;end;end
class Row
 attr_reader :data
 def initialize(data);@data=data.transform_keys(&:to_sym);end
 def method_missing(name,*args);if name.to_s.end_with?('=');@data[name.to_s[0...-1].to_sym]=args[0];else;@data[name];end;end
 def respond_to_missing?(*);true;end
 def reseed_notification_baseline!;@data[:reseeded]=true;end
end
class Scope<ActiveRecord::Relation
 include Enumerable
 def initialize(rows);@rows=rows;end
 def each(&b);@rows.each(&b);end
 def to_a;@rows;end
 def select(*fields);@rows.map{|r|r.public_send(fields[0])};end
 def pluck(*fields);select(*fields);end
 def where(*args)
  return self if args.empty?
  if args[0].is_a?(Hash);Scope.new(@rows.select{|r|args[0].all?{|k,v|v.is_a?(Array) ? v.include?(r.public_send(k)) : v==r.public_send(k)}})
  else;Scope.new(@rows.select{|r|args[1].include?(r.value.to_s.downcase)});end
 end
 def not(hash);Scope.new(@rows.reject{|r|hash.all?{|k,v|r.public_send(k)==v}});end
 def or(other);Scope.new((@rows+other.to_a).uniq);end
 def update_all(hash);@rows.each{|r|hash.each{|k,v|r.public_send(k.to_s+'=',v)}};end
 def find_each(&b);each(&b);end
end
class Merchant
 def self.transaction;yield;end
end
class FamilyMerchant<Merchant
 attr_accessor :id,:name,:family_id,:destroyed
 def initialize(id);@id=id;@name=id;@family_id='one';end
 def destroy!;@destroyed=true;end
end
class Entry
 class << self;attr_accessor :rows;def where(hash);Scope.new(rows).where(hash);end;end
end
class Rule
 class << self;attr_accessor :conditions,:actions;end
 class Condition;def self.where(*a);Scope.new(Rule.conditions).where(*a);end;end
 class Action;def self.where(*a);Scope.new(Rule.actions).where(*a);end;end
end
def method_source(path,name)
 text=File.read(path);found=nil;walk=->(n){if n.is_a?(RubyVM::AbstractSyntaxTree::Node);if [:DEFN,:DEFS].include?(n.type) && n.children.include?(name);found=text.lines[(n.first_lineno-1)..(n.last_lineno-1)].join;end;n.children.each{|c|walk.call(c)};end};walk.call(RubyVM::AbstractSyntaxTree.parse(text));raise 'Missing source method' unless found;found
end
Entry.class_eval(method_source(File.join(ARGV[0],'app/models/entry.rb'),:mark_user_modified_for_transactions!));Rule.class_eval(method_source(File.join(ARGV[0],'app/models/rule.rb'),:replace_merchant_references!));load File.join(ARGV[0],'app/models/merchant/merger.rb')
Family=Struct.new(:id,:merchants,:assigned_merchants,:transactions,:rules)
results=JSON.parse(STDIN.read).map do |c|
 s=c['state'];merchants=s['merchants'].map{|m|FamilyMerchant.new(m['id'])};transactions=s['transactions'].map{|t|Row.new(id:t['id'],merchant_id:t['merchantId'])};Entry.rows=transactions.map{|t|Row.new(entryable_type:'Transaction',entryable_id:t.id,user_modified:false)};rules=s['rules'].map{|r|Row.new(id:r['id'])};Rule.conditions=[];Rule.actions=[]
 s['rules'].each do |r|
  r['conditions'].each_with_index do |condition,i|
   id=r['id']+'-'+i.to_s
   if condition['field']=='group'
    Rule.conditions << Row.new(id:id,rule_id:r['id'],parent_id:nil,condition_type:'compound',value:'')
    condition['conditions'].each_with_index{|leaf,j|Rule.conditions << Row.new(id:id+'-'+j.to_s,rule_id:nil,parent_id:id,condition_type:'transaction_merchant',value:leaf['value'])}
   else;Rule.conditions << Row.new(id:id,rule_id:r['id'],parent_id:nil,condition_type:'transaction_merchant',value:condition['value']);end
  end
  r['actions'].each_with_index{|a,i|Rule.actions << Row.new(id:r['id']+'-a'+i.to_s,rule_id:r['id'],action_type:'set_transaction_merchant',value:a['value'])}
 end
 f=Family.new('one',Scope.new(merchants),Scope.new([]),Scope.new(transactions),Scope.new(rules));m=Merchant::Merger.new(family:f,target_merchant:merchants.find{|m|m.id=='keep'},source_merchants:c['sourceIds'].map{|id|merchants.find{|m|m.id==id}});raise 'No merge' unless m.merge!
 {count:m.merged_count,remaining:merchants.reject(&:destroyed).map(&:id),transactions:transactions.map{|t|[t.id,t.merchant_id,Entry.rows.find{|e|e.entryable_id==t.id}.user_modified]},conditions:Rule.conditions.reject{|r|r.condition_type=='compound'}.map(&:value),actions:Rule.actions.map(&:value)}
end
puts JSON.generate(results)
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8e6}));for(let i=0;i<cases.length;i++){const c=cases[i],p=planMerchantMerge(c.state,'keep',c.sourceIds),e=expected[i];assert.equal(p.counts.sources,e.count);assert.deepEqual(p.next.merchants.map(m=>m.id),e.remaining);assert.deepEqual(p.next.transactions.map(t=>[t.id,t.merchantId,t.lockedFields.includes('merchantId')]),e.transactions);assert.deepEqual(p.next.rules.flatMap(r=>r.conditions.flatMap(c=>c.field==='group'?c.conditions.map(l=>l.value):[c.value])),e.conditions);assert.deepEqual(p.next.rules.flatMap(r=>r.actions.map(a=>a.value)),e.actions);}
console.log('PASS 300 scenarios/12,000 transaction references across USD/JPY/KWD executing actual pinned Merchant::Merger, Entry manual-modification marking and Rule merchant-reference rewriting, including target exclusion, multiple sources, simple/compound/null-test/case-insensitive rule operands and unchanged unrelated rows. Controlled relation/model adapters are used; full Rails SQL, destruction callbacks, provider merchants and notification baselines are not claimed. Port split/recurring preservation is verified separately.');
