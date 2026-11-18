import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {planCategoryMerge} from '../lib/category-merge.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const cases=Array.from({length:300},(_,i)=>{const sourceIds=Array.from({length:1+i%4},(_,j)=>'source'+j),currency=['USD','JPY','KWD'][i%3],ids=['keep',...sourceIds,'unrelated','child'],s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Merge',currency,revision:0},accounts:[{id:'a',ownerId:'one',name:'Account',type:'checking',currency,openingBalance:10000,openingDate:'2020-01-01',archived:i%2}],categories:ids.map(id=>({id,ownerId:'one',name:id,color:'#112233',lucideIcon:'coffee',parentId:id==='child'?(i%5?'source0':null):null}))};if(i%10===0)s.categories.find(c=>c.id==='keep').parentId='source0';else if(i%10===1)s.categories.find(c=>c.id==='keep').parentId='unrelated';s.transactions=Array.from({length:40},(_,j)=>({id:'t'+j,ownerId:'one',accountId:'a',categoryId:j%7===0?null:ids[j%ids.length],date:'2026-01-01',name:'Transaction '+j,amount:j%5?j%2?-123:456:0,kind:'standard',transferId:null,merchantId:null,notes:'Keep',importKey:null,lockedFields:[]}));s.budgetBooks=[{id:'book',ownerId:'one',name:'Plan',currency,startDay:1,accountMode:'all',accountIds:[],sourceKind:'personal',sourceReference:null,legacyCompat:1}];s.budgetPeriods=Array.from({length:3},(_,j)=>({id:'p'+j,ownerId:'one',bookId:'book',startDate:`2026-0${j+1}-01`,endDate:`2026-0${j+1}-${j===1?'28':'31'}`,currency,budgetedSpending:10000,expectedIncome:null,autoTotal:0}));s.budgetEnvelopes=s.budgetPeriods.flatMap((p,j)=>ids.filter(id=>id!=='child'&&(id!=='keep'||(i+j)%2)).map((id,k)=>({id:p.id+id,ownerId:'one',periodId:p.id,categoryId:id,allocated:(k+1)*100,rolloverEnabled:(i+k)%2,importedCarry:k%2?20:null})));return {state:s,sourceIds:i%2?[...sourceIds,'keep']:sourceIds};});
const ruby=String.raw`
require 'json';require 'set';require 'bigdecimal';require 'bigdecimal/util'
class Set;def exclude?(value);!include?(value);end;end
class Object;def blank?;respond_to?(:empty?) ? empty? : !self;end;def present?;!blank?;end;end
class Row
 attr_reader :data
 def initialize(data);@data=data.transform_keys(&:to_sym);end
 def method_missing(name,*args);if name.to_s.end_with?('=');@data[name.to_s[0...-1].to_sym]=args[0];else;@data[name];end;end
 def respond_to_missing?(*);true;end
 def update!(hash);hash.each{|k,v|@data[k]=v};end
 def destroy!;@data[:destroyed]=true;end
end
class Scope
 include Enumerable
 attr_reader :rows
 def initialize(rows);@rows=rows.reject(&:destroyed);end
 def each(&b);@rows.each(&b);end
 def where(hash={});Scope.new(@rows.select{|r|hash.all?{|k,v|r.public_send(k)==v}});end
 def not(hash);Scope.new(@rows.reject{|r|hash.all?{|k,v|r.public_send(k)==v}});end
 def update_all(hash);@rows.each{|r|r.update!(hash)};end
 def exists?(hash);where(hash).any?;end
 def find(id);@rows.find{|r|r.id==id}||raise('missing');end
 def find_by(hash);where(hash).first;end
 def find_each(&b);each(&b);end
 def reselect(*);self;end
 def lock(*);self;end
 def to_sql;@rows.map{|r|"'#{r.id}'"}.join(',');end
end
class Category;def self.transaction;yield;end;end
class Entry
 class << self;attr_accessor :touched;def where(hash);@ids=hash[:entryable_id];self;end;def touch_all;@touched.concat(@ids);end;end
end
class Transaction
 REASSIGN_TOUCH_BATCH_SIZE=1000
 class << self
 attr_accessor :rows,:superseded
 def transaction;yield;end
 def quoted_table_name;'transactions';end
 def connection;self;end
 def quote(value);value ? "'#{value}'" : 'NULL';end
 def clear_query_cache;end
 def exec_query(sql,name);category=sql[/SET category_id = '([^']+)'/,1];ids=sql[/WHERE id IN \(([^)]+)\)/,1].scan(/'([^']+)'/).flatten;rows.select{|r|ids.include?(r.id)}.each{|r|r.category_id=category};Struct.new(:rows).new(ids.map{|id|[id]});end
 def supersede_automatic_category_claims!(ids);@superseded.concat(ids);end
 end
end
def method_source(path,name)
 text=File.read(path);found=nil;walk=->(n){if n.is_a?(RubyVM::AbstractSyntaxTree::Node);if [:DEFN,:DEFS].include?(n.type)&&n.children.include?(name);found=text.lines[(n.first_lineno-1)..(n.last_lineno-1)].join;end;n.children.each{|c|walk.call(c)};end};walk.call(RubyVM::AbstractSyntaxTree.parse(text));raise 'missing source method' unless found;found
end
Transaction.class_eval(method_source(File.join(ARGV[0],'app/models/transaction.rb'),:reassign_category!));load File.join(ARGV[0],'app/models/category/merger.rb')
Family=Struct.new(:id,:categories,:transactions,:budget_categories)
results=JSON.parse(STDIN.read).map do |c|
 s=c['state'];categories=s['categories'].map{|r|Row.new(id:r['id'],name:r['name'],family_id:'one',parent_id:r['parentId'],color:r['color'],lucide_icon:r['lucideIcon'])};transactions=s['transactions'].map{|t|Row.new(id:t['id'],category_id:t['categoryId'])};budgets=s['budgetEnvelopes'].map{|e|Row.new(id:e['id'],budget_id:e['periodId'],category_id:e['categoryId'],budgeted_spending:e['allocated'],rollover_enabled:e['rolloverEnabled'],imported_carry:e['importedCarry'])};f=Family.new('one',Scope.new(categories),Scope.new(transactions),Scope.new(budgets));Transaction.rows=transactions;Transaction.superseded=[];Entry.touched=[]
 begin
  merger=Category::Merger.new(family:f,target_category:categories.find{|r|r.id=='keep'},source_categories:c['sourceIds'].map{|id|categories.find{|r|r.id==id}});merger.merge!
  {count:merger.merged_count,categories:categories.reject(&:destroyed).map{|r|[r.id,r.parent_id,r.color,r.lucide_icon]},transactions:transactions.map{|r|[r.id,r.category_id]},budgets:budgets.reject(&:destroyed).map{|r|[r.id,r.budget_id,r.category_id,r.budgeted_spending.to_i,r.rollover_enabled,r.imported_carry]},touched:Entry.touched.sort,superseded:Transaction.superseded.sort}
 rescue Category::Merger::UnauthorizedCategoryError=>e;{error:e.message};end
end
puts JSON.generate(results)
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:12e6}));let valid=0,invalid=0;for(let i=0;i<cases.length;i++){const c=cases[i],e=expected[i];if(e.error){assert.throws(()=>planCategoryMerge(c.state,'keep',c.sourceIds));invalid++;continue;}const p=planCategoryMerge(c.state,'keep',c.sourceIds);valid++;assert.equal(p.counts.sources,e.count);assert.deepEqual(p.next.categories.map(c=>[c.id,c.parentId,c.color,c.lucideIcon]),e.categories);assert.deepEqual(p.next.transactions.map(t=>[t.id,t.categoryId]),e.transactions);assert.deepEqual(p.next.budgetEnvelopes.map(r=>[r.id,r.periodId,r.categoryId,r.allocated,r.rolloverEnabled,r.importedCarry]).sort(),e.budgets.sort());const affected=c.state.transactions.filter(t=>p.sourceIds.includes(t.categoryId)).map(t=>t.id).sort();assert.deepEqual(e.touched,affected);assert.deepEqual(e.superseded,affected);}
console.log(`PASS 300 category scenarios (${valid} valid/${invalid} rejected), 12,000 transaction references and separate USD/JPY/KWD budget periods executing actual pinned Category::Merger and Transaction.reassign_category!: hierarchy restrictions/reparenting, target exclusion, inclusive allocation sums, envelope identity and retained settings, exact touched/claim-superseded IDs. Controlled model/relation/SQL-execution adapters are used; full Rails locking/SQL/cache/destruction callbacks are not claimed. Manual locks, rule rewriting and recurring preservation are explicit port adaptations tested separately.`);
