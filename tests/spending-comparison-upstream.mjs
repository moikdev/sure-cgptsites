import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,precision,BUDGET_EXCLUDED_KINDS} from '../lib/finance.ts';import {createSpendingComparisonReport,spendingMonthShift} from '../lib/spending-comparison.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
let seed=711;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;},fixtures=[],expected=[];
for(let i=0;i<1050;i++){
 const currency=['USD','JPY','KWD'][i%3],scale=10**precision(currency),s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Comparison',currency,revision:0},accounts:[{id:'a',ownerId:'one',name:'Manual',type:'checking',currency,openingBalance:0,openingDate:'2020-01-01',archived:0}],categories:[{id:'food',ownerId:'one',name:'Food',parentId:null,color:'#445566'},{id:'groceries',ownerId:'one',name:'Groceries',parentId:'food',color:'#445566'},{id:'bakery',ownerId:'one',name:'Bakery',parentId:'food',color:'#445566'},{id:'travel',ownerId:'one',name:'Travel',parentId:null,color:'#556677'}]};
 const from=['2026-09-01','2025-10-01','2025-03-31','2024-02-29','2026-01-01'][i%5],end=new Date(Date.parse(from+'T00:00:00Z')+(29+random(140))*86400000).toISOString().slice(0,10),asOf=i%2?(end<'2026-10-15'?end:'2026-10-15'):new Date(Date.parse(from+'T00:00:00Z')+random(20)*86400000).toISOString().slice(0,10),includeInvestments=i%4!==0,options={currency,from,to:end,asOf,includeInvestments};
 const start=spendingMonthShift(from,-15);for(let j=0;j<40+random(120);j++){const date=new Date(Date.parse(start+'T00:00:00Z')+random(650)*86400000).toISOString().slice(0,10),amount=(random(4000)-3000)*scale+random(scale),categoryId=[null,'food','groceries','bakery','travel'][random(5)],kind=['standard','standard','standard','loan_payment','investment_contribution','funds_movement','one_time'][random(7)],excluded=random(12)===0?1:0;s.transactions.push({id:'t'+j,ownerId:'one',accountId:'a',categoryId,date,amount,name:'Entry',kind,excluded,transferId:null,notes:'',importKey:null});}
 const eligible=s.transactions.filter(t=>!t.excluded&&!BUDGET_EXCLUDED_KINDS.includes(t.kind)&&(includeInvestments||t.kind!=='investment_contribution')&&t.date<=asOf),historyStart=eligible.map(t=>t.date).sort()[0]??null,events=eligible.map(t=>({date:t.date,categoryId:t.categoryId,amount:['loan_payment','investment_contribution'].includes(t.kind)?-Math.abs(t.amount):t.amount}));
 fixtures.push({categories:s.categories,events,historyStart,currency,scale,options});expected.push(createSpendingComparisonReport(s,options));
}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'bigdecimal/util'
Duration=Struct.new(:months,:days)
class Integer
 def year;Duration.new(self*12,0);end
 def months;Duration.new(self,0);end
 def days;Duration.new(0,self);end
 def day;days;end
end
class Date
 alias_method :spending_original_minus,:-
 alias_method :spending_original_plus,:+
 def -(other);other.is_a?(Duration) ? (self << other.months).spending_original_minus(other.days) : spending_original_minus(other);end
 def +(other);other.is_a?(Duration) ? (self >> other.months).spending_original_plus(other.days) : spending_original_plus(other);end
end
class Object;def present?;!nil?;end;end
class Period
 attr_reader :start_date,:end_date
 def initialize(start_date:,end_date:);@start_date,@end_date=start_date,end_date;end
 def self.custom(**args);new(**args);end
end
class IncomeStatement;end
load File.join(ARGV[0],'app/models/income_statement/spending_comparison.rb')
Category=Struct.new(:id,:name,:color,:parent_id) do
 def subcategory?;!parent_id.nil?;end
 def uncategorized?;id.nil?;end
 def other_investments?;false;end
 def filter_value;id.nil? ? 'uncategorized' : name;end
end
CT=Struct.new(:category,:total);Totals=Struct.new(:classification,:category_totals)
class FixtureStatement
 attr_reader :family
 def initialize(c);@c=c;@family=Struct.new(:currency).new(c['currency']);@categories=c['categories'].map{|x|Category.new(x['id'],x['name'],x['color'],x['parentId'])}+[Category.new(nil,'Uncategorized','#a3a3a3',nil)];end
 def expense_totals(period:);totals(period,-1);end
 def income_totals(period:);totals(period,1);end
 def totals(p,sign)
  direct=Hash.new(0.to_d);@c['events'].each{|e|d=Date.iso8601(e['date']);if d>=p.start_date && d<=p.end_date && e['amount']*sign>0;direct[e['categoryId']]+=BigDecimal(e['amount'].abs.to_s)/@c['scale'];end}
  Totals.new(sign,@categories.map{|cat|CT.new(cat,direct[cat.id]+@categories.select{|child|child.parent_id==cat.id && child.subcategory?}.sum{|child|direct[child.id]})})
 end
end
results=JSON.parse(STDIN.read).map do |c|
 p=c['options'];comparison=IncomeStatement::SpendingComparison.new(FixtureStatement.new(c),period:Period.custom(start_date:Date.iso8601(p['from']),end_date:Date.iso8601(p['to'])),history_start:c['historyStart'] && Date.iso8601(c['historyStart']),as_of:Date.iso8601(p['asOf']))
 comparison.as_json.merge(changes:comparison.changes.map{|r|r.category.id},windows:(comparison.baseline_period ? (comparison.in_progress? ? comparison.send(:baseline_windows) : [comparison.baseline_period]) : []).map{|w|[w.start_date.iso8601,w.end_date.iso8601]})
end
puts JSON.generate(results)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify(fixtures),encoding:'utf8',maxBuffer:30e6}));let rows=0,decimalDust=0;
function amount(local,source,scale,context){if(source===null){assert.equal(local,null,context);return;}assert.ok(local!==null,context);const n=typeof local==='number'?local:Number(local.numerator)/Number(local.denominator),target=Number(source)*scale;assert.ok(Math.abs(n-target)<=Math.max(1e-7,Math.abs(target)*1e-12),`${context}: ${n} != ${target}`);}
for(let i=0;i<actual.length;i++){const source=actual[i],local=expected[i],scale=fixtures[i].scale;
 // Native integer inputs and <=366-day/12-window denominators cannot produce
 // a genuine positive normal below 1/366 minor unit. Ruby BigDecimal's
 // repeated division can leave ~1e-30 dust instead of exact zero, creating
 // phantom direct rows or enormous ratios. Exact rational arithmetic removes it.
 const clean=row=>{let dust=false;if(row.normal!==null&&Number(row.normal)!==0&&Math.abs(Number(row.normal)*scale)<1e-18){assert.ok(fixtures[i].events.every(e=>Number.isSafeInteger(e.amount)));assert.ok(local.baselineDays<=366&&local.windows.length<=12);row={...row,normal:'0',change:row.total,ratio:null};dust=true;decimalDust++;}if(row.subcategories)row={...row,subcategories:row.subcategories.map(clean).filter(Boolean)};return dust&&Number(row.total)===0?null:row;};source.categories=source.categories.map(clean).filter(Boolean);
assert.deepEqual(local.period,{from:source.period.start_date,to:source.period.end_date},`case ${i} period`);assert.equal(local.inProgress,source.in_progress);assert.equal(local.comparable,source.comparable);assert.deepEqual(local.baseline,source.baseline_period?{from:source.baseline_period.start_date,to:source.baseline_period.end_date}:null);assert.deepEqual(local.windows.map(w=>[w.from,w.to]),source.windows);amount(local.total,source.total,scale,`case ${i} total`);amount(local.normalTotal,source.normal_total,scale,`case ${i} normal`);assert.deepEqual(local.changes.map(k=>local.rows.find(r=>r.key===k).categoryId).sort(),source.changes.sort());
 assert.equal(local.rows.length,source.categories.length,`case ${i} categories`);for(const row of source.categories){const own=local.rows.find(r=>r.categoryId===row.id);assert.ok(own,`case ${i} missing ${row.id}`);for(const [a,b] of [[own,row],...row.subcategories.map(sub=>[own.children.find(s=>s.categoryId===sub.id&&s.direct===sub.direct),sub])]){assert.ok(a,`case ${i} missing child`);amount(a.total,b.total,scale,`case ${i} row total`);amount(a.normal,b.normal,scale,`case ${i} row normal`);amount(a.change,b.change,scale,`case ${i} row change`);assert.equal(a.ratio===null,b.ratio===null);if(a.ratio!==null)assert.ok(Math.abs(Number(a.ratio)-Number(b.ratio))<1e-10,`case ${i} ratio ${a.ratio} != ${b.ratio}`);rows++;}assert.equal(own.children.length,row.subcategories.length,`case ${i} child count`);}
}
console.log(`PASS ${actual.length} comparisons and ${rows} category/direct-row checks executing actual pinned SpendingComparison methods with independent scoped native totals; Rails SQL is not run; exact rationals remove ${decimalDust} proven Decimal-zero artifacts`);
