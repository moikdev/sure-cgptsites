import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {parseSureExport} from '../lib/sure-export.ts';import {planNativeMerge} from '../lib/native-merge.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const category=(name,parent=null,color='#123456',icon='home')=>({name,parent,color,icon}),fixtures=[
 {kind:'accounts',mapped:true,status:'active'}, {kind:'accounts',mapped:true,status:'disabled'}, {kind:'accounts',mapped:false,status:'active'}, {kind:'accounts',mapped:false,status:'disabled'},
 {kind:'category',existing:[category('Root')],rows:[{id:'root',name:'Root',color:'#abcdef',lucide_icon:'coffee'}]},
 {kind:'category',existing:[category('Root'),category('Child','Root')],rows:[{id:'child',name:'Child',color:'#abcdef',parent_id:null,lucide_icon:'coffee'}]},
 {kind:'category',existing:[category('Root'),category('Child','Root')],rows:[{id:'root',name:'Root',color:'#abcdef',lucide_icon:'coffee'}]},
 {kind:'category',existing:[category('Root'),category('Other'),category('Child','Root')],rows:[{id:'other',name:'Other',color:'#abcdef',lucide_icon:'house'},{id:'child',name:'Child',color:'#654321',parent_id:'other',lucide_icon:'coffee'}]},
 {kind:'category',existing:[],rows:[{id:'child',name:'Child',color:'#abcdef',parent_id:'root'},{id:'root',name:'Root',color:'#123456'}]},
 {kind:'tag',existing:[{name:'Trip',color:'#123456'}],rows:[{id:'tag',name:'Trip'}]},
 {kind:'tag',existing:[{name:'Trip',color:'#123456'}],rows:[{id:'tag',name:'Trip',color:null}]},
 {kind:'tag',existing:[{name:'Trip',color:'#123456'}],rows:[{id:'tag',name:'Trip',color:'#abcdef'}]},
 {kind:'tag',existing:[],rows:[{id:'tag',name:'Trip'}]},
 {kind:'merchant',existing:[{name:'Cafe',color:'#123456',website:'https://kept.example/'}],rows:[{id:'merchant',name:'Cafe',color:'#abcdef'}]},
 {kind:'merchant',existing:[{name:'Cafe',color:'#123456',website:'https://kept.example/'}],rows:[{id:'merchant',name:'Cafe',color:'#abcdef',website_url:null}]},
 {kind:'merchant',existing:[],rows:[{id:'merchant',name:'Cafe',color:'#abcdef',website_url:'https://new.example/'}]},
];
for(const f of fixtures){const s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Pinned',currency:'USD',revision:0}},target=crypto.randomUUID(),ids=new Map((f.existing??[]).map(c=>[c.name,crypto.randomUUID()])),account={type:'Account',data:{id:'source',name:'Imported',accountable_type:'Depository',subtype:'checking',balance:'25.00',currency:'USD',status:f.status??'active'}};
 if(f.kind==='accounts'&&f.mapped)s.accounts=[{id:target,ownerId:'one',name:'Kept',type:'checking',currency:'USD',openingBalance:10000,openingDate:'2026-01-01',archived:0}];
 if(f.kind==='category')s.categories=f.existing.map(c=>({id:ids.get(c.name),ownerId:'one',name:c.name,parentId:ids.get(c.parent)??null,color:c.color,lucideIcon:c.icon}));if(f.kind==='tag')s.tags=f.existing.map(t=>({id:ids.get(t.name),ownerId:'one',name:t.name,color:t.color}));if(f.kind==='merchant')s.merchants=f.existing.map(m=>({id:ids.get(m.name),ownerId:'one',name:m.name,color:m.color,websiteUrl:m.website}));
 const type={category:'Category',tag:'Tag',merchant:'Merchant'}[f.kind],rows=[account,...(f.rows??[]).map(data=>({type,data}))],data=parseSureExport(rows.map(JSON.stringify).join('\n'),{exportDate:'2026-02-28',name:'Source',currency:'USD'}).data,p=await planNativeMerge(s,data,[{sourceId:'source',targetId:f.mapped?target:null}],'seed','2026-02-28',new Set((f.rows??[]).filter(r=>Object.hasOwn(r,'website_url')).map(r=>r.id)),new Set((f.rows??[]).filter(r=>r.color!=null).map(r=>r.id)));
 if(f.kind==='accounts')f.expected={name:p.data.accounts[0].name,type:p.data.accounts[0].type,status:p.data.accounts[0].archived?'disabled':'active',balance:p.data.valuations.find(v=>v.kind==='current_anchor').amount/100,openingCalls:f.mapped?0:1,retainedOpening:f.mapped?p.data.accounts[0].openingBalance:null};
 else if(f.kind==='category')f.expected=p.data.categories.map(c=>({name:c.name,parent:p.data.categories.find(r=>r.id===c.parentId)?.name??null,color:c.color,icon:c.lucideIcon})).sort((a,b)=>a.name.localeCompare(b.name));
 else if(f.kind==='tag')f.expected=p.data.tags.map(t=>({name:t.name,color:t.color}));else f.expected=p.data.merchants.map(m=>({name:m.name,color:m.color,website:m.websiteUrl}));
}
const ruby=String.raw`
require 'json';require 'set';require 'date';require 'bigdecimal/util'
module ActiveModel;module Type;class Boolean;def cast(value);![nil,false,0,'0','false'].include?(value);end;end;end;end
class Time;def self.current;now;end;end
class Object;def blank?;false;end;def present?;!blank?;end;def in?(values);values.include?(self);end;end
class NilClass;def blank?;true;end;end
class FalseClass;def blank?;true;end;end
class String;def blank?;strip.empty?;end;end
class Depository;attr_accessor :subtype,:locked_attributes;end
class Investment;end;class Crypto;end;class Property;end;class Vehicle;end;class OtherAsset;end;class CreditCard;end;class Loan;end;class OtherLiability;end
class Record
 attr_accessor :id,:name,:color,:website_url,:logo_url,:pool
 def initialize(pool);@pool=pool;@id='record-'+pool.rows.length.to_s;end
 def assign_attributes(attrs);attrs.each{|key,value|send(key.to_s+'=',value)};end
 def save!;pool.rows<<self unless pool.rows.include?(self);self;end
end
class Account<Record
 attr_accessor :accountable,:balance,:cash_balance,:currency,:subtype,:institution_name,:institution_domain,:notes,:status,:opening
 def self.logo_selections;{};end
 class OpeningBalanceManager
  def initialize(account);@account=account;end
  def set_opening_balance(balance:,date:);@account.pool.opening_calls+=1;Struct.new(:success?).new(true);end
 end
end
class Children
 def initialize(rows);@rows=rows;end
 def exists?;@rows.any?;end
 def update_all(color:,**);@rows.each{|r|r.color=color;r.persisted_color=color};end
end
class Category<Record
 UNCATEGORIZED_COLOR='#737373'
 attr_accessor :classification_unused,:lucide_icon,:parent,:persisted_color
 def subcategory?;!parent.nil?;end
 def parent?;pool.rows.any?{|r|r.parent==self};end
 def subcategories;Children.new(pool.rows.select{|r|r.parent==self});end
 def parent_id=(value);self.parent=pool.find(value);end
 def update!(parent_id:);self.parent_id=parent_id;save!;end
 def save!;category_level_limit;inherit_color_from_parent;was_new=!pool.rows.include?(self);changed=persisted_color!=color;super;self.persisted_color=color;propagate_color_to_subcategories if !was_new&&changed;self;end
 def errors;Object.new.tap{|o|def o.add(*);raise 'invalid category';end};end
end
class Tag<Record;COLORS=['#e99537'];end
class Merchant<Record;end
class Pool
 attr_accessor :rows,:opening_calls
 def initialize(klass);@klass=klass;@rows=[];@opening_calls=0;end
 def find_by(**attrs);rows.find{|row|attrs.all?{|key,value|row.send(key)==value}};end
 def find(id);find_by(id:id)||raise('missing');end
 def build(**attrs);r=@klass.new(self);r.assign_attributes(attrs);r;end
end
class Family
 attr_accessor :accounts,:categories,:tags,:merchants,:currency
 def initialize;@accounts=Pool.new(Account);@categories=Pool.new(Category);@tags=Pool.new(Tag);@merchants=Pool.new(Merchant);@currency='USD';end
end
source=File.read(File.join(ARGV[0],'app/models/category.rb'))
Category.class_eval(source[/  def inherit_color_from_parent\n.*?\n  end/m]);Category.class_eval(source[/    def propagate_color_to_subcategories\n.*?\n    end/m]);Category.class_eval(source[/    def category_level_limit\n.*?\n    end/m])
load File.join(ARGV[0],'app/models/family/data_importer.rb')
results=JSON.parse(STDIN.read).map do |f|
 family=Family.new
 if f['kind']=='accounts'
  target=family.accounts.build(accountable:Depository.new);target.name='Kept';target.opening=10000;target.save! if f['mapped']
  importer=Family::DataImporter.new(family,'',account_targets:f['mapped'] ? {'source'=>target} : {})
  importer.instance_variable_set(:@imported_opening_anchor_account_ids,Set.new);importer.instance_variable_set(:@oldest_import_entry_dates_by_account,{})
  importer.send(:import_accounts,[{'data'=>{'id'=>'source','name'=>'Imported','accountable_type'=>'Depository','balance'=>'25.00','currency'=>'USD','status'=>f['status']}}]);a=family.accounts.rows.first
  {name:a.name,type:a.accountable.is_a?(Depository) ? 'checking' : 'other',status:a.status,balance:a.balance.to_f,openingCalls:family.accounts.opening_calls,retainedOpening:f['mapped'] ? a.opening : nil}
 else
  key={'category'=>:categories,'tag'=>:tags,'merchant'=>:merchants}.fetch(f['kind']);pool=family.send(key)
  f.fetch('existing',[]).each do |c|;r=pool.build(name:c['name'],color:c['color']);r.website_url=c['website'] if key==:merchants;r.lucide_icon=c['icon'] if key==:categories;r.save!;end
  f.fetch('existing',[]).each{|c|pool.find_by(name:c['name']).parent=pool.find_by(name:c['parent']) if key==:categories&&c['parent']}
  importer=Family::DataImporter.new(family,'');importer.send('import_'+key.to_s,f.fetch('rows').map{|r|{'data'=>r}})
  pool.rows.map do |r|
   if key==:categories;{name:r.name,parent:r.parent&.name,color:r.color,icon:r.lucide_icon};elsif key==:tags;{name:r.name,color:r.color};else;{name:r.name,color:r.color,website:r.website_url};end
  end.sort_by{|r|r[:name]}
 end
end
puts JSON.generate(results)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(fixtures),encoding:'utf8'}));for(let i=0;i<fixtures.length;i++)assert.deepEqual(actual[i],fixtures[i].expected,'Fixture '+i);console.log(`${fixtures.length} pinned Ruby native account-target and shared-metadata cases passed (actual methods with persistence stubs; not full Rails SQL).`);
