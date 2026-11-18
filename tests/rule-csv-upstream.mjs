import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {parseRuleCSV,ruleCSVOptionsSchema} from '../lib/rule-csv-format.ts';import {toCSV,parseCSV} from '../lib/csv.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const c={condition_type:'transaction_name',operator:'like',value:'Cafe 東京'},a={action_type:'set_transaction_name',value:'Coffee'},header=['name','resource_type','active','effective_date','conditions','actions','group'],base=[' Named ','transaction','true','2024-02-29',JSON.stringify([c]),JSON.stringify([a]),'Group'],fixtures=[];
const add=(rows,h=header,delimiter=',')=>{const raw=toCSV([h,...rows]);if(delimiter===',')fixtures.push({csv:raw,delimiter});else fixtures.push({csv:parseCSV(raw).map(r=>r.map(v=>/["\r\n]/.test(v)||v.includes(delimiter)?'"'+v.replaceAll('"','""')+'"':v).join(delimiter)).join('\r\n'),delimiter});};
add([base]);for(const value of ['true','TRUE','1','yes','y','false','0','no','n','','other']){const r=[...base];r[2]=value;add([r]);}for(const value of ['','not-a-date','2024-02-29','2025-02-29','31/12/2024']){const r=[...base];r[3]=value;add([r]);}for(const delimiter of [';','\t','|'])add([base],header,delimiter);add([[...base.slice(0,6)]],header.slice(0,6));add([[...base.slice(0,6),'']]);add([['',...base.slice(1)]]);add([[...base,'']], [...header,'']);
for(const value of ['quote " / comma, / line\nnext',String.raw`literal\nstring`,String.raw`Cafe\u0020Shop`,String.raw`quote\"here`]){const r=[...base];r[4]=JSON.stringify([{...c,value}]);add([r]);}const wrapped=[...base];wrapped[4]=JSON.stringify(JSON.stringify([c]));add([wrapped]);const legacy=[...base];legacy[4]=String.raw`[{\"condition_type\":\"transaction_name\",\"operator\":\"like\",\"value\":\"Cafe\u0020Shop\"}]`;add([legacy]);
fixtures.push({csv:'name,resource_type,active,effective_date,conditions,actions,group\nLoose,transaction,true,,"[{"condition_type":"transaction_name","operator":"like","value":"Coffee"}]","[{"action_type":"set_transaction_name","value":"Cafe"}]",Group',delimiter:','});
add([[...base.slice(0,4),JSON.stringify([{condition_type:'compound',operator:'or',sub_conditions:[c,{...c,value:'Bakery'}]}]),JSON.stringify([a,{action_type:'set_transaction_tags',value:'Shared,"Comma, tag"'}]),'Shopping']]);
for(const f of fixtures){const options=ruleCSVOptionsSchema.parse({delimiter:f.delimiter}),p=parseRuleCSV(f.csv,options);f.expected=p.map(r=>({name:r.name,resource_type:r.resourceType,active:r.active,effective_date:r.effectiveDate,conditions:r.conditions,actions:r.actions,group:r.group}));}
const ruby=String.raw`
require 'csv';require 'json';require 'date'
class Object;def blank?;respond_to?(:empty?) ? empty? : !self;end;def present?;!blank?;end;def presence;present? ? self : nil;end;def in?(values);values.include?(self);end;end
class String;def blank?;strip.empty?;end;end
class NilClass;def blank?;true;end;end
class Import;attr_accessor :col_sep;end
class Rule;def self.human_attribute_name(v);v;end;end
module DatabaseTextValidator;def self.acceptable?(v);!v.to_s.include?("\0")&&v.to_s.valid_encoding?;end;end
load File.join(ARGV[0],'app/models/rule_import.rb')
result=JSON.parse(STDIN.read).map do |f|
 model=RuleImport.new;model.col_sep=f.fetch('delimiter');text=f.fetch('csv').delete_prefix("\uFEFF");header_size=CSV.parse_line(text.strip,col_sep:model.col_sep,liberal_parsing:true).size
 CSV.parse(text.strip,headers:true,col_sep:model.col_sep,converters:[->(s){s&.strip}],liberal_parsing:true).map do |row|
  r=model.send(:normalize_rule_row,row,header_size:header_size);name=r[:name].to_s.strip
  {name:name.empty? ? nil : name,resource_type:r[:resource_type].to_s.strip,active:model.send(:parse_boolean,r[:active]),effective_date:model.send(:parse_date,r[:effective_date])&.iso8601,conditions:model.send(:parse_json_safely,r[:conditions],'conditions'),actions:model.send(:parse_json_safely,r[:actions],'actions'),group:r[:rule_group]&.strip}
 end
end
puts JSON.generate(result)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(fixtures),encoding:'utf8'}));for(let i=0;i<fixtures.length;i++)assert.deepEqual(actual[i],fixtures[i].expected,'Fixture '+i);console.log(`${fixtures.length} pinned Ruby rule CSV parser, normalizer, boolean and date comparisons passed (actual methods with minimal model stubs; not full Rails SQL).`);
