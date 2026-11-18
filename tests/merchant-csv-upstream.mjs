import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {planMerchantCSV} from '../lib/merchant-csv.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const fixtures=[{csv:'name*,color,website_url\nCoffee,#abcdef,https://coffee.example',existing:[]},{csv:'Name,Color,Website URL\n A ,#123456, https://a.example ',existing:[]},{csv:'name,color,website\nBookstore,,',existing:[]},{csv:'name,color,website_url\nNew,invalid,https://new.example',existing:[]},{csv:'name,color,website_url\nExisting,#ffffff,https://changed.example',existing:[{name:'Existing',color:'#123456',websiteUrl:'https://saved.example'}]},{csv:'name,color,website_url\nRepeated,#123456,https://first.example\nRepeated,#abcdef,https://second.example',existing:[]},{csv:'name,color,website_url\n ,bad,javascript:ignored',existing:[]},{csv:'name,color\nCase,#123456\ncase,#abcdef',existing:[]},{csv:'name,website-url\nCafe,https://cafe.example',existing:[]},{csv:'name,color\n"Cafe, 東京",#123456',existing:[]}];
for(const f of fixtures){const p=await planMerchantCSV(f.csv,',',f.existing.map((m,i)=>({...m,id:'old-'+i,ownerId:'one'})),'one','seed');f.expected=[...f.existing,...p.created].map(({name,color,websiteUrl})=>({name,color,websiteUrl})).sort((a,b)=>a.name.localeCompare(b.name));}
const ruby=String.raw`
require 'json';require 'csv'
class String;def blank?;strip.empty?;end;def present?;!blank?;end;def presence;present? ? self : nil;end;end
class NilClass;def presence;nil;end;def present?;false;end;end
class FamilyMerchant;COLORS=['#e99537'];end
class Import
 attr_accessor :family,:raw,:rows
 def transaction;yield;end
 def csv_headers;CSV.parse(raw,headers:true).headers;end
 def csv_rows;CSV.parse(raw,headers:true);end
 def default_currency;'USD';end
end
class Record
 attr_accessor :name,:color,:website_url
 def initialize(pool,name,color=nil,website=nil);@pool=pool;@name=name;@color=color;@website_url=website;end
 def new_record?;!@pool.records.include?(self);end
 def save!;@color='#e99537' unless @color&.match?(/\A#[0-9A-Fa-f]{6}\z/);@pool.records<<self;end
end
class Pool
 attr_reader :records
 def initialize;@records=[];end
 def find_or_initialize_by(name:);records.find{|r|r.name==name}||Record.new(self,name);end
end
class Rows < Array
 def destroy_all;clear;end
 def create!(**attrs);self << Struct.new(*attrs.keys).new(*attrs.values);end
end
load File.join(ARGV[0],'app/models/merchant_import.rb')
result=JSON.parse(STDIN.read).map do |f|
 pool=Pool.new;f.fetch('existing').each{|m|pool.records<<Record.new(pool,m.fetch('name'),m.fetch('color'),m['websiteUrl'])};m=MerchantImport.new;m.family=Struct.new(:merchants).new(pool);m.raw=f.fetch('csv');m.rows=Rows.new;m.generate_rows_from_csv;m.import!;pool.records.map{|r|{name:r.name,color:r.color,websiteUrl:r.website_url}}.sort_by{|r|r[:name]}
end
puts JSON.generate(result)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(fixtures),encoding:'utf8'}));for(let i=0;i<fixtures.length;i++)assert.deepEqual(actual[i].sort((a,b)=>a.name.localeCompare(b.name)),fixtures[i].expected);console.log('10 pinned Ruby merchant CSV cases passed (actual parsing/import methods with persistence stubs; not full Rails SQL).');
