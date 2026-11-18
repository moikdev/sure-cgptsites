import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {prepareCSVEntities} from '../lib/csv-entity-mapping.ts';import {planStagedCSV} from '../lib/csv-staging-plan.ts';import {emptyState} from '../lib/finance.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const cat=(name,parent=null,color='#123456')=>({name,parent,color}),fixtures=[{kind:'category',key:'Plain',categories:[]},{kind:'category',key:'Home:Child',categories:[]},{kind:'category',key:'Home:Child',categories:[cat('Home')]},{kind:'category',key:'Existing child:New child',categories:[cat('Root'),cat('Existing child','Root')]},{kind:'category',key:'Fresh:Existing child',categories:[cat('Root'),cat('Existing child','Root')]},{kind:'category',key:'Root:Root',categories:[]},{kind:'category',key:'Root:Child:detail',categories:[]},{kind:'tag',key:'New tag',categories:[],tags:[]},{kind:'tag',key:'Work',categories:[],tags:[{name:'Work',color:'#123456'}]},{kind:'category',key:'Skipped',categories:[],skip:true}],options={delimiter:',',dateFormat:'ymd',numberFormat:'decimal-dot',amountMode:'signed',signage:'outflows-negative',columns:{date:0,name:1,amount:2,category:3,tags:4,notes:5}},state=()=>({...structuredClone(emptyState),profile:{ownerId:'one',name:'Pinned',currency:'USD',revision:0},accounts:[{id:crypto.randomUUID(),ownerId:'one',name:'Cash',type:'checking',currency:'USD',openingBalance:0,openingDate:'2026-01-01',archived:0}]});
for(const f of fixtures){const s=state(),ids=new Map(f.categories.map(c=>[c.name,crypto.randomUUID()]));s.categories=f.categories.map(c=>({...c,id:ids.get(c.name),parentId:c.parent?ids.get(c.parent):null,ownerId:'one'}));s.tags=(f.tags??[]).map(t=>({...t,id:crypto.randomUUID(),ownerId:'one'}));const text=f.kind==='category'?`d,n,a,c,t,note\n2026-02-01,A,1,${f.key},,`:`d,n,a,c,t,note\n2026-02-01,A,1,,"[""${f.key}""]",`,m={categories:f.kind==='category'?[f.skip?{sourceName:f.key,mode:'skip'}:{sourceName:f.key,mode:'create',name:f.key,color:'#e99537'}]:[{sourceName:'',mode:'skip'}],tags:f.kind==='tag'?[{sourceName:f.key,mode:'create',name:f.key,color:'#e99537'}]:[]},p=await prepareCSVEntities(s,text,options,m,'seed');f.expected={target:p.resolved.find(c=>c.kind===(f.kind==='category'?'categories':'tags')).targetName,categories:p.state.categories.map(c=>({name:c.name,parent:p.state.categories.find(parent=>parent.id===c.parentId)?.name??null,color:c.color})).sort((a,b)=>a.name.localeCompare(b.name)),tags:p.state.tags.map(t=>t.name).sort()};}
const updates=[];for(const hasCategory of [false,true])for(const hasTags of [false,true])for(const note of ['', 'CSV note']){const s=state(),oldCat=crypto.randomUUID(),newCat=crypto.randomUUID(),oldTag=crypto.randomUUID(),newTag=crypto.randomUUID();s.categories=[{id:oldCat,ownerId:'one',name:'Old category',color:'#123456',parentId:null},{id:newCat,ownerId:'one',name:'New category',color:'#123456',parentId:null}];s.tags=[{id:oldTag,ownerId:'one',name:'Old tag',color:'#123456'},{id:newTag,ownerId:'one',name:'New tag',color:'#123456'}];const text=`d,n,a,c,t,note\n2026-02-01,A,1,Source category,"[""Source tag""]",${note}`,base=await planStagedCSV(s,s.accounts[0].id,text,{...options,columns:{date:0,name:1,amount:2,notes:5}});s.transactions=base.newRows.map(t=>({...t,categoryId:oldCat,tagIds:[oldTag],notes:'Saved note'}));const m={categories:[hasCategory?{sourceName:'Source category',mode:'existing',targetId:newCat}:{sourceName:'Source category',mode:'skip'}],tags:[hasTags?{sourceName:'Source tag',mode:'existing',targetId:newTag}:{sourceName:'Source tag',mode:'skip'}]},p=await prepareCSVEntities(s,text,options,m,'seed'),plan=await planStagedCSV(p.state,s.accounts[0].id,text,options,undefined,'seed','2026-03-01',p.resolve),t=plan.pending.transactions[0];updates.push({hasCategory,hasTags,note,expected:{category:p.state.categories.find(c=>c.id===t.categoryId).name,tags:t.tagIds.map(id=>p.state.tags.find(t=>t.id===id).name),notes:t.notes}});}
const ruby=String.raw`
require 'json';require 'set'
class NilClass;def present?;false;end;end
class String;def present?;!strip.empty?;end;end
class Category
 COLORS=['#e99537']
 def self.suggested_icon(_name);'icon';end
end
class Record
 attr_accessor :name,:parent,:color,:lucide_icon
 def initialize(name,color=nil);@name=name;@color=color;end
 def subcategory?;!parent.nil?;end
 def present?;true;end
end
class Pool
 attr_reader :rows
 def initialize(rows);@rows=rows;end
 def roots;Roots.new(self);end
 def find_by(name:);rows.find{|r|r.name==name};end
 def find_or_create_by!(name:);found=find_by(name:name);return found if found;r=Record.new(name);yield r if block_given?;rows<<r;r;end
end
class Roots
 def initialize(pool);@pool=pool;end
 def find_by(name:);@pool.rows.find{|r|r.name==name&&!r.subcategory?};end
 def find_by!(name:);find_by(name:name)||raise('Missing root');end
 def create!(name:);r=Record.new(name);yield r;@pool.rows<<r;r;end
end
class Mapping
 attr_accessor :import,:mappable,:key,:enabled
 def creatable?;enabled;end
 def save!;end
end
class CategoryMapping<Mapping;end
class TagMapping<Mapping;end
cat=File.read(File.join(ARGV[0],'app/models/import/category_mapping.rb'));tag=File.read(File.join(ARGV[0],'app/models/import/tag_mapping.rb'))
CategoryMapping.class_eval(cat[/  def create_mappable!\n.*?\n  end/m]);CategoryMapping.class_eval(cat[/    def create_root_category!\(name\)\n.*?\n    end/m]);TagMapping.class_eval(tag[/  def create_mappable!\n.*?\n  end/m])
Family=Struct.new(:categories,:tags);ImportFixture=Struct.new(:family)
input=JSON.parse(STDIN.read)
created=input.fetch('fixtures').map do |f|
 rows=f.fetch('categories').map{|c|Record.new(c.fetch('name'),c.fetch('color'))};f.fetch('categories').each_with_index{|c,i|rows[i].parent=rows.find{|r|r.name==c['parent']} if c['parent']};tags=f.fetch('tags',[]).map{|t|Record.new(t.fetch('name'),t['color'])};family=Family.new(Pool.new(rows),Pool.new(tags));m=(f.fetch('kind')=='category' ? CategoryMapping : TagMapping).new;m.import=ImportFixture.new(family);m.key=f.fetch('key');m.enabled=!f['skip'];m.create_mappable!
 {target:m.mappable&.name,categories:rows.map{|r|{name:r.name,parent:r.parent&.name,color:r.color}}.sort_by{|c|c[:name]},tags:tags.map(&:name).sort}
end
Entry=Struct.new(:id,:transaction,:notes,:import_locked);Transaction=Struct.new(:category,:tags);Row=Struct.new(:notes)
source=File.read(File.join(ARGV[0],'app/models/transaction_import.rb'))[/        if duplicate_entry\n(.*?)        else\n/m,1];raise 'Pinned duplicate branch missing' unless source
updated=input.fetch('updates').map do |c|
 duplicate_entry=Entry.new('entry',Transaction.new(Record.new('Old category'),[Record.new('Old tag')]),'Saved note',false);category=c.fetch('hasCategory') ? Record.new('New category') : nil;tags=c.fetch('hasTags') ? [Record.new('New tag')] : [];row=Row.new(c.fetch('note'));updated_entries=[];claimed_entry_ids=Set.new;eval(source,binding)
 {category:duplicate_entry.transaction.category.name,tags:duplicate_entry.transaction.tags.map(&:name),notes:duplicate_entry.notes}
end
puts JSON.generate({created:created,updated:updated})
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify({fixtures,updates}),encoding:'utf8'}));assert.deepEqual(actual.created,fixtures.map(f=>f.expected));assert.deepEqual(actual.updated,updates.map(c=>c.expected));console.log('18 pinned Ruby category/tag creation and duplicate-metadata cases passed (association stubs; not full Rails SQL).');
