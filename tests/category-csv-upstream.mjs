import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {planCategoryCSV} from '../lib/category-csv.ts';import {emptyState} from '../lib/finance.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const c=(name,parent=null,color='#123456',icon='home')=>({name,parent,color,icon}),fixtures=[
{csv:'name*,color,parent_category,lucide_icon\nFood,#abcdef,,carrot\nChild,#112233,Food,shopping-basket'},
{csv:'name,color,parent category,icon\nChild,#123456,Parent,plug\nParent,#abcdef,,house'},
{csv:'name,parent_category\nChild,Placeholder'},
{csv:'name,color,icon\nExisting,#abcdef,pizza',existing:[c('Existing')]},
{csv:'name,color,icon\nRepeated,#aaaaaa,cookie\nRepeated,#bbbbbb,pizza\nRepeated,,'},
{csv:'name,color,parent_category,icon\nChild,#aaaaaa,Parent,pizza\nParent,#bbbbbb,,home\nChild,#cccccc,,'},
{csv:'name,color\nRoot,#abcdef',existing:[c('Root'),c('Unlisted','Root')]},
{csv:'name\nChild',existing:[c('Root'),c('Child','Root')]},
{csv:'name,parent_category\nA,A'},
{csv:'name,parent_category\nA,B\nB,A'},
{csv:'name,parent_category\nA,B\nB,C'},
{csv:'name,parent_category\nB,C\nA,B'},
{csv:'name,parent_category\nRoot,Another',existing:[c('Root'),c('Unlisted','Root')]},
{csv:' Name* ,COLOR,parent-category,Lucide Icon\n Cafe ,#abcdef,,coffee'},
{csv:'name,color\nCase,#abcdef\ncase,#123456'},
{csv:'name,color\nA,invalid'},
];
for(const f of fixtures){const existing=f.existing??[],ids=new Map(existing.map(c=>[c.name,crypto.randomUUID()])),state={...structuredClone(emptyState),profile:{ownerId:'one',name:'Pinned',currency:'USD',revision:0},categories:existing.map(c=>({id:ids.get(c.name),ownerId:'one',name:c.name,color:c.color,parentId:ids.get(c.parent)??null,lucideIcon:c.icon}))};try{const p=await planCategoryCSV(f.csv,',',state,'seed','2026-02-01');f.expected={categories:p.state.categories.map(c=>({name:c.name,color:c.color,parent:p.state.categories.find(p=>p.id===c.parentId)?.name??null,icon:c.lucideIcon??null})).sort((a,b)=>a.name.localeCompare(b.name))};}catch{f.expected={error:true};}}
const ruby=String.raw`
require 'json';require 'csv'
class String;def blank?;strip.empty?;end;def present?;!blank?;end;def presence;present? ? self : nil;end;end
class NilClass;def blank?;true;end;def present?;false;end;def presence;nil;end;end
class Time;def self.current;now;end;end
class Errors;def add(*);raise 'invalid';end;end
class Import
 attr_accessor :family,:raw,:rows
 def transaction;yield;end
 def csv_headers;CSV.parse(raw,headers:true).headers;end
 def csv_rows;CSV.parse(raw,headers:true);end
 def default_currency;'USD';end
 def errors;Errors.new;end
end
class Children
 def initialize(rows);@rows=rows;end
 def exists?;@rows.any?;end
 def update_all(color:,**);@rows.each{|r|r.color=color;r.persisted_color=color};end
end
class Category
 UNCATEGORIZED_COLOR='#737373'
 attr_accessor :name,:color,:parent,:lucide_icon,:persisted_color
 def initialize(pool,name,color=nil,icon=nil,persisted=false);@pool=pool;@name=name;@color=color;@lucide_icon=icon;@persisted=persisted;@persisted_color=color;end
 def present?;true;end
 def errors;Errors.new;end
 def subcategory?;!parent.nil?;end
 def parent?;@pool.records.any?{|r|r.parent==self};end
 def subcategories;Children.new(@pool.records.select{|r|r.parent==self});end
 def save!
  raise 'invalid metadata' if name.blank?||!color&.match?(/\A#[0-9A-Fa-f]{6}\z/)||lucide_icon.blank?
  category_level_limit;inherit_color_from_parent;changed=persisted_color!=color;was_new=!@persisted;@pool.records<<self if was_new;@persisted=true;self.persisted_color=color;propagate_color_to_subcategories if !was_new&&changed;self
 end
 def update!(parent:);self.parent=parent;save!;end
end
source=File.read(File.join(ARGV[0],'app/models/category.rb'))
Category.class_eval(source[/  def inherit_color_from_parent\n.*?\n  end/m]);Category.class_eval(source[/    def propagate_color_to_subcategories\n.*?\n    end/m]);Category.class_eval(source[/    def category_level_limit\n.*?\n    end/m])
class Pool
 attr_reader :records
 def initialize;@records=[];end
 def find_by(name:);records.find{|r|r.name==name};end
 def find_by!(name:);find_by(name:name)||raise('missing');end
 def find_or_initialize_by(name:);find_by(name:name)||Category.new(self,name);end
 def find_or_create_by!(name:);found=find_by(name:name);return found if found;r=Category.new(self,name);yield r;r.save!;end
end
class Rows<Array
 def destroy_all;clear;end
 def create!(**attrs);self<<Struct.new(*attrs.keys).new(*attrs.values);end
end
load File.join(ARGV[0],'app/models/category_import.rb')
results=JSON.parse(STDIN.read).map do |f|
 begin
  pool=Pool.new;f.fetch('existing',[]).each{|c|pool.records<<Category.new(pool,c.fetch('name'),c.fetch('color'),c.fetch('icon'),true)};f.fetch('existing',[]).each{|c|pool.find_by!(name:c.fetch('name')).parent=pool.find_by(name:c['parent']) if c['parent']};m=CategoryImport.new;m.family=Struct.new(:categories).new(pool);m.raw=f.fetch('csv');m.rows=Rows.new;m.generate_rows_from_csv;m.import!;{categories:pool.records.map{|c|{name:c.name,color:c.color,parent:c.parent&.name,icon:c.lucide_icon}}}
 rescue
  {error:true}
 end
end
puts JSON.generate(results)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(fixtures),encoding:'utf8'}));for(let i=0;i<fixtures.length;i++){actual[i].categories?.sort((a,b)=>a.name.localeCompare(b.name));assert.deepEqual(actual[i],fixtures[i].expected,'Fixture '+i);}console.log('16 pinned Ruby category CSV and model callback cases passed (actual methods with persistence stubs; not full Rails SQL).');
