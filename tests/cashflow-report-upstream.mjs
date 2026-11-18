import {taxAdvantaged} from '../lib/account-details.ts';
import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,BUDGET_EXCLUDED_KINDS,today} from '../lib/finance.ts';import {createCashflowReport} from '../lib/cashflow-report.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');let seed=871;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;},fixtures=[],expected=[];
for(let i=0;i<240;i++){const currency=['USD','JPY','KWD'][i%3],s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Cashflow',currency,revision:0},accounts:['a','b','archived','excluded'].map(id=>({id,ownerId:'one',name:id,type:'checking',currency,openingBalance:0,openingDate:'1900-01-01',archived:Number(id==='archived'),excludedFromReports:Number(id==='excluded')})),categories:[{id:'food',ownerId:'one',name:'Food',color:'#445566',parentId:null},{id:'groceries',ownerId:'one',name:'Groceries',color:'#445566',parentId:'food'},{id:'salary',ownerId:'one',name:'Salary',color:'#445566',parentId:null}]},o={currency,from:['2026-01-01','2024-02-29','2025-03-15'][i%3],to:['2026-12-31','2024-06-15','2025-10-31'][i%3],asOf:'2026-10-15',includeInvestments:i%4!==0,...(i%5===0?{accountId:'a'}:{})};const restricted=s.accounts.find(a=>a.id==='b');Object.assign(restricted,i%4===0?{type:'investment',subtype:'ira'}:i%4===1?{subtype:'hsa'}:i%4===2?{type:'crypto',subtype:'wallet',cryptoTaxTreatment:'tax_exempt'}:{type:'investment',subtype:'future_subtype'});for(let j=0;j<110;j++)s.transactions.push({id:'t'+j,ownerId:'one',accountId:['a','a','b','archived','excluded'][random(5)],categoryId:[null,'food','groceries','salary'][random(4)],date:new Date(Date.UTC(2023,0,1+random(1460))).toISOString().slice(0,10),amount:random(2001)-1000,name:'Entry',kind:['standard','standard','loan_payment','investment_contribution','funds_movement','one_time','cc_payment'][random(7)],excluded:Number(random(11)===0),investmentActivity:[null,null,null,'Transfer','Sweep In','Sweep Out','Exchange','Dividend'][random(8)],transferId:null,notes:'',importKey:null});const r=createCashflowReport(s,o),periods=[r.periods.current,r.periods.previous,...r.trends.map(m=>({from:m.from,to:m.to}))];fixtures.push({s,o,taxIds:s.accounts.filter(taxAdvantaged).map(a=>a.id),today:today(),excluded:BUDGET_EXCLUDED_KINDS,periods});expected.push(r);}
// Execute the pinned SQL builder unchanged. The relation caller supplies the
// date/scheduled scope; actual Totals SQL supplies classifications and excludes.
const sqlRuby=String.raw`
require 'json';require 'date'
class Object;def present?;!nil? && self!=false && !(respond_to?(:empty?) && empty?);end;end
class Date;def self.current;Date.iso8601($as_of);end;end
class IncomeStatement;end
class Transaction;BUDGET_EXCLUDED_KINDS=%w[funds_movement cc_payment one_time];end
module ActiveRecord
 class Base
  def self.sanitize_sql_array(pair)
   sql,params=pair
   quote=->(v){v.is_a?(Array) ? v.map{|x|quote.call(x)}.join(', ') : v.is_a?(Numeric) ? v.to_s : "'"+v.to_s.gsub("'","''")+"'"}
   sql.gsub(/:(\w+)/){quote.call(params.fetch($1.to_sym))}
  end
 end
end
load File.join(ARGV[0],'app/models/income_statement/scoped_transactions_query.rb')
load File.join(ARGV[0],'app/models/income_statement/totals.rb')
class Family
 attr_reader :currency
 def initialize(o);@currency=o['currency'];@include=o['includeInvestments'];end
 def id;'one';end
 def tax_advantaged_account_ids;$tax_ids;end
 def investment_contributions_as_spending?;@include;end
end
results=JSON.parse(STDIN.read).map do |f|
 o=f['o'];$as_of=o['asOf'];$tax_ids=f['taxIds'];family=Family.new(o);ids=o['accountId'] ? [o['accountId']] : f['s']['accounts'].map{|a|a['id']}
 f['periods'].map do |p|
  from,to=Date.iso8601(p['from']),Date.iso8601(p['to']);scope=Struct.new(:to_sql).new("SELECT t.* FROM transactions t JOIN entries e ON e.entryable_id=t.id WHERE e.date >= '#{p['from']}' AND e.date <= '#{p['to']}' AND e.date <= '#{o['asOf']}'")
  IncomeStatement::Totals.new(family,transactions_scope:scope,date_range:from..to,included_account_ids:ids).send(:query_sql)
 end
end
puts JSON.generate(results)
`;
const queries=JSON.parse(execFileSync('ruby',['-e',sqlRuby,reference],{input:JSON.stringify(fixtures),encoding:'utf8',maxBuffer:25e6}));
const python=String.raw`
import json,sqlite3,sys
fixtures,queries=json.load(sys.stdin);out=[]
for f,qs in zip(fixtures,queries):
 db=sqlite3.connect(':memory:');db.row_factory=sqlite3.Row
 db.executescript('CREATE TABLE transactions(id TEXT,kind TEXT,category_id TEXT,investment_activity_label TEXT);CREATE TABLE entries(id TEXT,entryable_id TEXT,entryable_type TEXT,account_id TEXT,amount INTEGER,date TEXT,currency TEXT,excluded INTEGER);CREATE TABLE accounts(id TEXT,family_id TEXT,status TEXT,exclude_from_reports INTEGER);CREATE TABLE categories(id TEXT,parent_id TEXT);CREATE TABLE exchange_rates(date TEXT,from_currency TEXT,to_currency TEXT,rate NUMERIC);')
 s=f['s'];db.executemany('INSERT INTO accounts VALUES(?,?,?,?)',[(a['id'],'one','disabled' if a['archived'] else 'active',a['excludedFromReports']) for a in s['accounts']]);db.executemany('INSERT INTO categories VALUES(?,?)',[(c['id'],c['parentId']) for c in s['categories']])
 for t in s['transactions']:
  db.execute('INSERT INTO transactions VALUES(?,?,?,?)',(t['id'],t['kind'],t['categoryId'],t['investmentActivity']));db.execute('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?)',(t['id'],t['id'],'Transaction',t['accountId'],-t['amount'],t['date'],f['o']['currency'],t['excluded']))
 # Every amount is uniformly scaled to the fixture currency's minor unit.
 # Native identity conversion/classification and SQL sums are scale invariant.
 out.append([{k:sum(row['total'] for row in db.execute(q) if row['classification']==k) for k in ['income','expense','investment']} for q in qs]);db.close()
print(json.dumps(out))
`;
const totals=JSON.parse(execFileSync('python3',['-c',python],{input:JSON.stringify([fixtures,queries]),encoding:'utf8',maxBuffer:10e6}));
const controllerRuby=String.raw`
require 'json';require 'date';require 'bigdecimal'
class Integer;def day;self;end;def days;self;end;end
class Date;def beginning_of_month;Date.new(year,month,1);end;def end_of_month;(beginning_of_month>>1)-1;end;def next_month;self>>1;end;def self.current;Date.iso8601($today);end;end
class Period
 attr_reader :start_date,:end_date
 def initialize(start_date:,end_date:);@start_date,@end_date=start_date,end_date;end
 def self.custom(**args);new(**args);end
end
class Money
 attr_reader :amount
 def initialize(a,c=nil);@amount=a;end
 def zero?;amount.zero?;end
 def -(o);Money.new(amount-o.amount);end
 def /(o);BigDecimal(amount.to_s)/o.amount;end
end
module Current;def self.family;Struct.new(:currency).new('NATIVE');end;end
class SourceReport
 source=File.read(File.join(ARGV[0],'app/controllers/reports_controller.rb'))
 class_eval(source[source.index('    def build_previous_period')...source.index('    def calculate_budget_performance')])
 class_eval(source[source.index('    def build_trends_data')...source.index('    def build_transactions_breakdown')])
 class_eval(source[source.index('    def ensure_money')...source.index('    def parse_date_param')])
 def calculate_budget_performance;nil;end
 def initialize(f,totals)
  o=f['o'];@start_date,@end_date=Date.iso8601(o['from']),Date.iso8601(o['to']);@current_income_totals=Struct.new(:total).new(totals[0]['income']);@current_expense_totals=Struct.new(:total).new(totals[0]['expense']);@previous_income_totals=Struct.new(:total).new(totals[1]['income']);@previous_expense_totals=Struct.new(:total).new(totals[1]['expense']);@fixture=f;@totals=totals
 end
 def call
  summary=build_summary_metrics.transform_values{|v|v.is_a?(Money) ? v.amount : v}
  lookup=@fixture['periods'].zip(@totals).to_h{|p,t|[[p['from'],p['to']],t]}
  stmt=Object.new;stmt.define_singleton_method(:income_totals){|period:|Struct.new(:total).new(lookup.fetch([period.start_date.iso8601,period.end_date.iso8601])['income'])};stmt.define_singleton_method(:expense_totals){|period:|Struct.new(:total).new(lookup.fetch([period.start_date.iso8601,period.end_date.iso8601])['expense'])}
  previous=build_previous_period
  {summary:summary,previous:[previous.start_date.iso8601,previous.end_date.iso8601],trends:build_trends_data(income_statement:stmt)}
 end
end
fixtures,totals=JSON.parse(STDIN.read);puts JSON.generate(fixtures.zip(totals).map{|f,t|$today=f['today'];SourceReport.new(f,t).call})
`;
const source=JSON.parse(execFileSync('ruby',['-e',controllerRuby,reference],{input:JSON.stringify([fixtures,totals]),encoding:'utf8',maxBuffer:10e6}));let cells=0;for(let i=0;i<expected.length;i++){const r=expected[i],s=source[i],t=totals[i];assert.deepEqual([r.periods.previous.from,r.periods.previous.to],s.previous);for(const [k,local] of [['current_income',r.current.income.amount],['current_expenses',r.current.expense.amount],['net_savings',r.net]])assert.equal(local,s.summary[k],`case ${i} ${k}`);assert.equal(Number(r.incomeChange),Number(s.summary.income_change));assert.equal(Number(r.expenseChange),Number(s.summary.expense_change));assert.equal(r.trends.length,s.trends.length);for(let j=0;j<r.trends.length;j++){const a=r.trends[j],b=s.trends[j];assert.equal(a.income.amount,b.income);assert.equal(a.expense.amount,b.expenses);assert.equal(a.net,b.net);assert.equal(a.isCurrentMonth,b.is_current_month);assert.equal(a.investment.amount,t[j+2].investment);cells++;}}console.log(`PASS ${source.length} summary/previous-period cases and ${cells} month rows: actual pinned IncomeStatement Totals SQL executed in SQLite plus actual ReportsController summary/percentage/previous/trends methods; independent caller date scope, native identity amounts, known tax-account IDs supplied from separately verified metadata rules; no full Rails pending-provider, Money FX or budget-bootstrap claim`);
