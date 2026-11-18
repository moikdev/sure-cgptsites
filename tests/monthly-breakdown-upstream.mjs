import {taxAdvantaged} from '../lib/account-details.ts';
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,precision,BUDGET_EXCLUDED_KINDS} from '../lib/finance.ts';import {createMonthlyBreakdown} from '../lib/monthly-breakdown.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');let seed=729;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;},fixtures=[],expected=[];
for(let i=0;i<420;i++){const currency=['USD','JPY','KWD'][i%3],scale=10**precision(currency),s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Monthly',currency,revision:0},accounts:['a','b','archived','excluded'].map(id=>({id,ownerId:'one',name:id,type:'checking',currency,openingBalance:0,openingDate:'1900-01-01',archived:Number(id==='archived'),excludedFromReports:Number(id==='excluded')})),categories:[{id:'food',ownerId:'one',name:'Food',parentId:null,color:'#445566'},{id:'groceries',ownerId:'one',name:'Groceries',parentId:'food',color:'#445566'},{id:'travel',ownerId:'one',name:'Travel',parentId:null,color:'#445566'}],tags:[{id:'tag',ownerId:'one',name:'Work',color:'#445566'}]},o={currency,from:['2024-02-29','2025-03-15','2026-01-01'][i%3],to:'2026-12-31',asOf:'2026-10-15',includeScheduled:true,includeInvestments:i%4!==0,...(i%5===0?{categoryId:'food'}:{}),...(i%6===0?{accountId:'a'}:{}),...(i%7===0?{tagId:'tag'}:{}),...(i%8===0?{minimum:'2',maximum:'25'}:{}),...(i%9===0?{filterFrom:'2026-01-10',filterTo:'2026-09-20'}:{})};const restricted=s.accounts.find(a=>a.id==='b');Object.assign(restricted,i%4===0?{type:'investment',subtype:'ira'}:i%4===1?{subtype:'hsa'}:i%4===2?{type:'crypto',subtype:'wallet',cryptoTaxTreatment:'tax_exempt'}:{type:'investment',subtype:'future_subtype'});for(let j=0;j<75;j++)s.transactions.push({id:'t'+j,ownerId:'one',accountId:['a','a','b','archived','excluded'][random(5)],categoryId:[null,'food','groceries','travel'][random(4)],date:new Date(Date.UTC(2024,0,random(1095)+1)).toISOString().slice(0,10),amount:(random(60)-40)*scale+random(scale),name:'Entry',kind:['standard','standard','loan_payment','investment_contribution','funds_movement','one_time','cc_payment'][random(7)],excluded:Number(random(12)===0),tagIds:random(2)?['tag']:[],transferId:null,notes:'',importKey:null});fixtures.push({s,o,taxIds:s.accounts.filter(taxAdvantaged).map(a=>a.id),scale,excluded:[...BUDGET_EXCLUDED_KINDS,...(!o.includeInvestments?['investment_contribution']:[])]});expected.push(createMonthlyBreakdown(s,o));}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal'
class Object;def present?;!nil? && self!='' && self!=false;end;def blank?;!present? || respond_to?(:empty?) && empty?;end;end
class Date;def beginning_of_month;Date.new(year,month,1);end;def end_of_month;(beginning_of_month>>1)-1;end;def next_month;self>>1;end;end
module Current;class << self;attr_accessor :family,:user;end;end
Account=Class.new {def self.included_in_reports;:report_included;end}
Category=Struct.new(:id,:name,:parent_id)
class Categories
 def initialize(rows);@rows=rows;end
 def where(parent_id:);Categories.new(@rows.select{|c|c.parent_id==parent_id});end
 def pluck(k);@rows.map{|r|r.send(k)};end
end
class Relation
 include Enumerable
 def initialize(rows);@rows=rows;end
 def each(&b);@rows.each(&b);end
 def joins(*);self;end
 def includes(*);self;end
 def merge(*);Relation.new(@rows.reject{|t|t.entry.account.excluded});end
 def where(*args)
  return WhereChain.new(self) if args.empty?
  q,arg=args;rows=@rows
  if q.is_a?(String)
   rows=rows.select{|t|q.include?('ABS') ? (q.include?('>=') ? t.entry.amount.abs>=BigDecimal(arg.to_s) : t.entry.amount.abs<=BigDecimal(arg.to_s)) : (q.include?('>=') ? t.entry.date>=arg : t.entry.date<=arg)}
  else
   rows=rows.select do |t|
    q.all? do |scope,opts|
     if scope==:category_id;Array(opts).include?(t.category&.id)
     elsif scope==:taggings;t.tags.include?(opts[:tag_id])
     else
      record=scope==:accounts ? t.entry.account : t.entry
      opts.all?{|k,v|value=record.send(k);v.is_a?(Range) ? v.cover?(value) : v.is_a?(Array) ? v.include?(value) : value==v}
     end
    end
   end
  end
  Relation.new(rows)
 end
 def without(q);Relation.new(@rows.reject{|t|q.key?(:kind) ? q[:kind].include?(t.kind) : q[:accounts][:id].include?(t.entry.account.id)});end
 class WhereChain;def initialize(s);@scope=s;end;def not(q);@scope.without(q);end;end
end
class Transaction;class << self;attr_accessor :rows;def joins(*);Relation.new(rows);end;end;end
class Money
 ConversionError=Class.new(StandardError)
 attr_reader :amount
 def initialize(a,c);@amount,@currency=a,c;end
 def exchange_to(c);raise ConversionError unless @currency==c;self;end
end
class SourceReport
 attr_accessor :params
 source=File.read(File.join(ARGV[0],'app/controllers/reports_controller.rb'))
 filters=source[source.index('    def apply_transaction_filters')...source.index('    def build_transactions_breakdown_for_export')]
 monthly=source[source.index('    def build_monthly_breakdown_for_export')...source.index('    def generate_transactions_csv')]
 class_eval(filters+monthly)
 def initialize(o);@start_date=Date.iso8601(o['from']);@end_date=Date.iso8601(o['to']);@period=Struct.new(:date_range).new(@start_date..@end_date);@params={filter_category_id:o['categoryId'],filter_account_id:o['accountId'],filter_tag_id:o['tagId'],filter_amount_min:o['minimum'],filter_amount_max:o['maximum'],filter_date_start:o['filterFrom'],filter_date_end:o['filterTo']};end
end
results=JSON.parse(STDIN.read).map do |f|
 s,o=f['s'],f['o'];categories=s['categories'].map{|c|Category.new(c['id'],c['name'],c['parentId'])};accounts=s['accounts'].to_h{|a|[a['id'],Struct.new(:id,:family_id,:status,:excluded).new(a['id'],'one',a['archived']==1 ? 'disabled' : 'active',a['excludedFromReports']==1)]}
 Current.family=Struct.new(:id,:currency,:categories,:tax_advantaged_account_ids,:analytics_excluded_kinds).new('one',o['currency'],Categories.new(categories),f['taxIds'],f['excluded']);Current.user=Struct.new(:finance_accounts).new(Categories.new(accounts.values))
 Transaction.rows=s['transactions'].map do |t|
  e=Struct.new(:account,:account_id,:amount,:date,:currency,:entryable_type,:excluded).new(accounts[t['accountId']],t['accountId'],-BigDecimal(t['amount'].to_s)/f['scale'],Date.iso8601(t['date']),o['currency'],'Transaction',t['excluded']==1)
  Struct.new(:entry,:kind,:category,:tags).new(e,t['kind'],categories.find{|c|c.id==t['categoryId']},t['tagIds'])
 end
 r=SourceReport.new(o).build_monthly_breakdown_for_export
 {months:r[:months].map{|d|d.strftime('%Y-%m')},rows:(r[:income]+r[:expenses]).map{|row|{name:row[:category],direction:row[:type],total:(row[:total]*f['scale']).to_i,cells:row[:months].to_h{|d,a|[d.strftime('%Y-%m'),(a*f['scale']).to_i]}}}}
end
puts JSON.generate(results)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify(fixtures),encoding:'utf8',maxBuffer:20e6}));let rows=0,cells=0;for(let i=0;i<actual.length;i++){const a=actual[i],r=expected[i];assert.deepEqual(r.months,a.months);assert.equal(r.rows.length,a.rows.length,`case ${i} rows`);for(const row of a.rows){const local=r.rows.find(x=>x.name===row.name&&x.direction===row.direction);assert.ok(local,`case ${i} ${row.name}`);assert.equal(local.total.amount,row.total);assert.deepEqual(Object.fromEntries([...local.cells].map(([m,c])=>[m,c.amount])),row.cells);rows++;cells+=local.cells.size;}}console.log(`PASS ${actual.length} native-currency scenarios, ${rows} category/direction rows and ${cells} monthly cells executing pinned ReportsController monthly builder and filters; independent relation shim with known tax-account exclusion; metadata rules verified separately, no full Rails SQL or FX provider claim`);
