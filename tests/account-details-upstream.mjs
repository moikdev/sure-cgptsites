import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {ACCOUNTABLE_TYPES,subtypeCatalog,taxTreatment,taxAdvantaged} from '../lib/account-details.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const cases=[];for(const type of Object.keys(ACCOUNTABLE_TYPES)){for(const subtype of [...Object.keys(subtypeCatalog(type)),null,'future_subtype','constructor'])cases.push({id:String(cases.length),type,accountableType:ACCOUNTABLE_TYPES[type],subtype});}for(const cryptoTaxTreatment of ['taxable','tax_deferred','tax_exempt'])cases.push({id:String(cases.length),type:'crypto',accountableType:'Crypto',subtype:'wallet',cryptoTaxTreatment});
const ruby=String.raw`
require 'json'
module Accountable;end
module ActiveSupport;module Concern;end;end
class Object;def in?(list);list.include?(self);end;end
class ApplicationRecord;attr_accessor :subtype;def self.enum(*);end;end
load File.join(ARGV[0],'app/models/investment.rb');load File.join(ARGV[0],'app/models/depository.rb');load File.join(ARGV[0],'app/models/crypto.rb');load File.join(ARGV[0],'app/models/concerns/tax_treatable.rb')
class Crypto;attr_accessor :tax_treatment;end
class Account;include TaxTreatable;attr_accessor :accountable;end
rows=JSON.parse(STDIN.read)
values=rows.map do |c|
 model=case c['type'];when 'investment';Investment.new;when 'checking','savings';Depository.new;when 'crypto';Crypto.new;else;Object.new;end
 model.subtype=c['subtype'] if model.respond_to?(:subtype=);model.tax_treatment=c['cryptoTaxTreatment'] || 'taxable' if c['type']=='crypto'
 account=Account.new;account.accountable=model
 {id:c['id'],tax_treatment:account.tax_treatment,advantaged:account.tax_advantaged?,taxable:account.taxable?}
end
# Execute the actual pinned Family methods. Relation adapters implement only the
# explicit family-owned joins, subtype/treatment filters and plucks they call.
class Relations
 def initialize(rows,type=nil);@rows=rows;@type=type;end
 def joins(sql);Relations.new(@rows,sql[/accounts.accountable_type = '([^']+)'/,1]);end
 def where(hash);key=hash.keys.first;wanted=hash.values.first;Relations.new(@rows.select{|r|r['accountableType']==@type && wanted.all?{|field,values|values.include?(field==:subtype ? r['subtype'] : (r['cryptoTaxTreatment'] || 'taxable'))}},@type);end
 def pluck(_);@rows.map{|r|r['id']};end
end
source=File.read(File.join(ARGV[0],'app/models/family.rb'));definitions={}
visit=->(node){if node.is_a?(RubyVM::AbstractSyntaxTree::Node);if node.type==:DEFN && [:tax_advantaged_account_ids,:tax_advantaged_depository_account_ids].include?(node.children[0]);definitions[node.children[0]]=source.lines[(node.first_lineno-1)..(node.last_lineno-1)].join;end;node.children.each{|child|visit.call(child)};end};visit.call(RubyVM::AbstractSyntaxTree.parse(source));raise 'Missing source methods' unless definitions.length==2
family=Class.new{attr_accessor :accounts};definitions.each_value{|definition|family.class_eval(definition)};f=family.new;f.accounts=Relations.new(rows)
catalog={};%w[Depository Investment Crypto Property Vehicle Loan CreditCard OtherAsset OtherLiability].each{|name|file=name.gsub(/([a-z])([A-Z])/,'\1_\2').downcase;text=File.read(File.join(ARGV[0],'app/models',file+'.rb'));block=text[/^  SUBTYPES = (\{.*?^  \})\.freeze/m,1];catalog[name]=block ? eval(block) : {}}
puts JSON.generate({values:values,family_ids:f.tax_advantaged_account_ids,catalog:catalog})
`;
const source=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:3e6}));for(const [type,name] of Object.entries(ACCOUNTABLE_TYPES))assert.deepEqual(subtypeCatalog(type),source.catalog[name]);
for(let i=0;i<cases.length;i++){assert.equal(taxTreatment(cases[i]),source.values[i].tax_treatment);assert.equal(taxAdvantaged(cases[i]),source.values[i].advantaged);assert.equal(!taxAdvantaged(cases[i]),source.values[i].taxable);}
assert.deepEqual(source.family_ids.sort(),cases.filter(taxAdvantaged).map(c=>c.id).sort());console.log(`PASS ${cases.length} account tax cases, ${Object.keys(source.catalog).length} full subtype catalogs and actual pinned Investment/Depository/TaxTreatable/Family methods; relation joins/filter/pluck use controlled adapters, not full Rails SQL or tax advice.`);
