import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {importRows} from '../lib/csv.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const fixtures=[];for(const selected of ['Credit','Debit','inflows_positive','__proto__'])for(const value of ['Credit','Debit','credit','','inflows_positive','__proto__'])for(const treatment of ['inflow','outflow'])for(const amount of ['1.23','-1.23','0.29','-0.29'])for(const signage of ['outflows-negative','outflows-positive']){const options={delimiter:';',dateFormat:'ymd',numberFormat:'decimal-dot',amountMode:'custom',signage,amountTypeValue:selected,amountTypeTreatment:treatment,columns:{date:0,name:1,amount:2,entity_type:3}},csv=`d;n;a;t\n2026-01-02;Synthetic;${amount};${value}`,expected=importRows(csv,'USD',undefined,options)[0].amount;fixtures.push({selected,value,treatment,amount,signage,expected});}
const ruby=String.raw`
require 'json';require 'bigdecimal';require 'bigdecimal/util'
class Object;def present?;!nil? && (!respond_to?(:empty?) || !empty?);end;def in?(list);list.include?(self);end;end
source=File.read(File.join(ARGV[0],'app/models/import/row.rb'))
klass=Class.new{attr_accessor :import,:entity_type,:amount}
klass.class_eval(source[/  def signed_amount\n.*?\n  end/m]);klass.class_eval(source[/    def apply_transaction_signage_convention\(value\)\n.*?\n    end/m])
config=Struct.new(:type,:amount_type_strategy,:amount_type_identifier_value,:amount_type_inflow_value,:signage_convention)
result=JSON.parse(STDIN.read).map do |f|
 row=klass.new;row.entity_type=f.fetch('value');row.amount=f.fetch('amount');row.import=config.new('TransactionImport','custom_column',f.fetch('selected'),f.fetch('treatment')=='inflow' ? 'inflows_positive' : 'inflows_negative',f.fetch('signage')=='outflows-negative' ? 'inflows_positive' : 'inflows_negative');(-row.signed_amount*100).to_i
end
puts JSON.generate(result)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(fixtures),encoding:'utf8',maxBuffer:2_000_000}));for(const [i,f] of fixtures.entries())assert.equal(actual[i],f.expected,JSON.stringify(f));console.log(`${fixtures.length} actual pinned Ruby custom-column signed-amount comparisons passed`);
