import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,parseMoney} from '../lib/finance.ts';import {investmentImportRows} from '../lib/investment-csv.ts';import {createInvestmentCSVTemplate,applyInvestmentCSVTemplate} from '../lib/investment-csv-mapping.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const ruby=String.raw`
require 'json';require 'csv';require 'bigdecimal/util'
class Object;def present?;true;end;def blank?;!present?;end;end
class NilClass;def present?;false;end;end
class String;def present?;!strip.empty?;end;end
class Hash;def slice(*keys);select{|key,_|keys.include?(key)};end;end
class Import
 attr_accessor :account,:family,:type
 class Row;attr_accessor :import,:qty,:price;end
end
source=File.read(File.join(ARGV[0],'app/models/import.rb'))
Import.class_eval(source[/  def suggested_template\n.*?\n  end/m]);Import.class_eval(source[/  def template_attributes\(import_template\)\n.*?\n  end/m])
row=File.read(File.join(ARGV[0],'app/models/import/row.rb'))
Import::Row.class_eval(row[/  def signed_amount\n.*?\n  end/m]);Import::Row.class_eval(row[/    def apply_trade_signage_convention\(value\)\n.*?\n    end/m])
load File.join(ARGV[0],'app/models/trade_import.rb')
import=TradeImport.new;import.account=Object.new;csv=import.csv_template
settings=Struct.new(:type,:signage_convention).new('TradeImport','inflows_positive')
trades=csv.map do |r|;row=Import::Row.new;row.import=settings;row.qty=r['qty*'];row.price=r['price*'];{qty:row.qty,price:row.price,cash:row.signed_amount.to_s('F'),label:import.send(:investment_activity_label_for,row.qty)};end
class Pool
 attr_accessor :where_args,:order_args,:rows
 def complete;self;end
 def where(**attrs);self.where_args=attrs;self;end
 def order(**attrs);self.order_args=attrs;self;end
 def first;rows.first;end
end
pool=Pool.new;pool.rows=['newest completed scoped import'];import.family=Struct.new(:imports).new(pool);import.type='TradeImport';suggested=import.suggested_template
attrs={'date_col_label'=>'Booking','ticker_col_label'=>'Symbol','qty_col_label'=>'Shares','price_col_label'=>'Price','date_format'=>'%d/%m/%Y','number_format'=>'1.234,56','rows_to_skip'=>2,'raw_file_str'=>'NEVER COPY SOURCE','account_id'=>'NEVER COPY TARGET'};copied=import.template_attributes(Struct.new(:attributes).new(attrs))
puts JSON.generate({csv:csv.to_csv,trades:trades,scope:{same_account:pool.where_args[:account].equal?(import.account),type:pool.where_args[:type],order:pool.order_args,suggested:suggested},copied:copied})
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{encoding:'utf8'})),s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Pinned',currency:'USD',revision:0},accounts:[{id:'a',ownerId:'one',name:'Portfolio',type:'investment',currency:'USD',openingBalance:0,openingDate:'2024-01-01',archived:0}],securities:['AAPL','GOOGL','TSLA'].map((ticker,i)=>({id:'s'+i,ownerId:'one',ticker,exchange:'XNAS',name:ticker,kind:'standard',websiteUrl:null}))},p=await investmentImportRows(s,{kind:'trades',accountId:'a',currency:'USD',csv:actual.csv});let checks=0;
for(let i=0;i<3;i++){checks++;assert.equal(p.trades[i].cashAmount,-parseMoney(actual.trades[i].cash,'USD'));checks++;assert.equal(p.trades[i].activity,actual.trades[i].label.toLowerCase());checks++;assert.equal(p.trades[i].qty,String(Number(actual.trades[i].qty)));}
checks++;assert.deepEqual(actual.scope,{same_account:true,type:'TradeImport',order:{created_at:'desc'},suggested:'newest completed scoped import'});checks++;assert.ok(!Object.hasOwn(actual.copied,'raw_file_str')&&!Object.hasOwn(actual.copied,'account_id'));const template=createInvestmentCSVTemplate(actual.csv,'trades');checks++;assert.equal(template.columns.exchange,'exchange_operating_mic');checks++;assert.equal(template.columns.qty,'qty*');checks++;assert.deepEqual(applyInvestmentCSVTemplate(actual.csv,'trades',template).activityMode,'signed-quantity');console.log(`${checks} pinned Ruby trade CSV, signed amount, activity and template-selection checks passed (actual methods with persistence stubs; not full Rails SQL).`);
