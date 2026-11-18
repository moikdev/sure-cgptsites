import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {planTransferClassification,INVESTMENT_CONTRIBUTION_NAMES} from '../lib/transfer-classification.ts';
const root='/tmp/sure-upstream-port-reference',cases=[];let seed=73;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let n=0;n<600;n++){
 const from=['checking','loan','credit','investment','crypto'][next()%5],to=['investment','crypto','checking','loan','other_liability'][next()%5],kind=['investment_contribution','funds_movement','cc_payment','loan_payment'][next()%4],enabled=next()%2===0,categoryName=[null,'Other purpose',...INVESTMENT_CONTRIBUTION_NAMES][next()%(INVESTMENT_CONTRIBUTION_NAMES.length+2)],locks=[[],['name'],['kind'],['categoryId']][next()%4],s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Oracle',currency:'USD',revision:1},accounts:[{id:'a',ownerId:'one',name:'Source',type:from,currency:'USD',openingBalance:1000000,openingDate:'2026-01-01',archived:0},{id:'b',ownerId:'one',name:'Destination',type:to,currency:'USD',openingBalance:0,openingDate:'2026-01-01',archived:0}],categories:categoryName?[{id:'category',ownerId:'one',name:categoryName,color:'#123456',parentId:null}]:[],transactions:[{id:'out',ownerId:'one',accountId:'a',categoryId:categoryName?'category':null,date:'2026-02-01',name:'Original',amount:-10000,kind,transferId:'pair',notes:'',importKey:null,lockedFields:locks},{id:'in',ownerId:'one',accountId:'b',categoryId:null,date:'2026-02-01',name:'Original',amount:10000,kind:'funds_movement',transferId:'pair',notes:'',importKey:null}]};
 let expected;try{const p=planTransferClassification(s,'pair',enabled,'2026-03-01');expected={valid:true,kind:p.outflow.kind,category:p.review.categoryAfter,locks:p.outflow.lockedFields.slice().sort()};}catch{expected={valid:false,kind,category:categoryName,locks:locks.slice().sort()};}cases.push({from,to,kind,enabled,category:categoryName,locks,expected});
}
const ruby=String.raw`
require 'json';require 'yaml'
root=ARGV[0]
locales=File.read(File.join(root,'app/helpers/languages_helper.rb'))[/SUPPORTED_LOCALES = \[(.*?)\]\.freeze/m,1].scan(/"([^"]+)"/).flatten
$names=locales.map{|locale|path=File.join(root,'config/locales/models/category',locale+'.yml'); File.exist?(path) ? YAML.load_file(path).dig(locale,'models','category','investment_contributions') || 'Investment Contributions' : 'Investment Contributions'}.uniq
class ApplicationRecord
 def self.belongs_to(name,**kwargs);attr_accessor name;end
 def self.has_many(*args,**kwargs);end
 def self.enum(*args,**kwargs);end
 def self.validates(*args,**kwargs);end
 def self.validate(*args,**kwargs);end
 def self.before_destroy(*args,**kwargs);end
 def self.transaction;yield;end
end
class Category;def self.all_investment_contributions_names;$names;end;end
CategoryRow=Struct.new(:name)
class Account
 attr_reader :type
 def initialize(type);@type=type;end
 def present?;true;end
 def loan?;type=='loan';end
 def credit_card?;type=='credit';end
 def investment?;type=='investment';end
 def crypto?;type=='crypto';end
 def liability?;['loan','credit','other_liability'].include?(type);end
 def family;self;end
 def investment_contributions_category;CategoryRow.new('Investment Contributions');end
end
class Row
 attr_accessor :kind,:category,:locks,:entry
 def initialize(kind,category,locks,account);@kind=kind;@category=category;@locks=locks;@entry=Struct.new(:account).new(account);end
 def lock!;end
 def update!(attrs);attrs.each{|key,value|send(key.to_s+'=',value)};end
 def lock_attr!(key);@locks=(@locks+[key.to_s]).uniq;end
 def locked?(key);@locks.include?(key.to_s);end
end
load File.join(root,'app/models/transfer.rb')
class Transfer;def confirmed?;true;end;end
rows=JSON.parse(STDIN.read).map do |c|
 t=Transfer.new
 r=Row.new(c['kind'],c['category'] ? CategoryRow.new(c['category']) : nil,c['locks'],Account.new(c['from']))
 t.outflow_transaction=r;t.inflow_transaction=Row.new('funds_movement',nil,[],Account.new(c['to']))
 valid=t.update_investment_contribution!(c['enabled'])
 {valid:valid,kind:r.kind,category:r.category&.name,locks:r.locks.sort}
end
puts JSON.generate({names:$names.sort,rows:rows})
`;
const result=spawnSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8000000});assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);assert.deepEqual(actual.names,Array.from(INVESTMENT_CONTRIBUTION_NAMES).sort());assert.equal(actual.rows.length,cases.length);for(let i=0;i<cases.length;i++)assert.deepEqual(actual.rows[i],cases[i].expected,'Original Ruby contribution switch case '+i);
console.log(`Matched ${cases.length} original Ruby Transfer#update_investment_contribution! cases and all ${actual.names.length} supported localized category names.`);
