import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,CURRENCIES} from '../lib/finance.ts';import {validateDailyPrices} from '../lib/daily-prices.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const row=(price='1',patch={})=>({date:'2026-01-02',price,currency:'USD',...patch}),base={cash:false,prices:[],trades:['USD'],holdings:[],rows:[row()]};
const inputs=[{...base,prices:['EUR','JPY','USD'],rows:[row('1',{currency:'KWD'})]},{...base,prices:['EUR','JPY','USD'],rows:[row('1',{currency:'EUR'})]},...['1','.25','1.','+1.2000','1e2','1e-4','1_000.2_5','1_',' 1.20 ','999999999999999.9999','0','-1','NaN','Infinity','-Infinity','+Infinity','1e-40','1e40','1.00001','1000000000000000','1,000','1__0','1_.2','1e2_','1e1_0','1.2e-0_2','bad',null,12.34].map(price=>({...base,rows:[row(price)]})),...['2026-02-30','2026-03-02','2026-W01-1','2026-002','20260102',' 2026-01-02','2024-02-29'].map(date=>({...base,rows:[row('1',{date})]})),...['usd',' JPY ','BAD',''].map(currency=>({...base,rows:[row('1',{currency})]})),{...base,rows:[]},{...base,rows:Array(1001).fill(row())},{...base,rows:[null,[],{},row('0'),row('2',{currency:'BAD'}),row('3'),row('4')]},{...base,cash:true},{...base,cash:true,rows:[row('bad')]},{...base,prices:['JPY']},{...base,prices:['JPY'],rows:[row('2',{currency:'JPY'})]},{...base,prices:['JPY','USD'],rows:[row('1'),row('2',{date:'2026-01-03',currency:'JPY'})]},{...base,trades:['USD','JPY']},{...base,trades:[],holdings:['KWD'],rows:[row('2',{currency:'KWD'})]},{...base,trades:[],holdings:['KWD','USD']},{...base,trades:[],holdings:[]},{...base,trades:[],holdings:[],rows:[row('bad')]},{...base,rows:[row('bad'),row('1',{currency:'JPY'})]}];
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal'
class Date;def self.current;Date.iso8601('2026-03-01');end;end
class Object;def blank?;respond_to?(:empty?) ? empty? : !self;end;end
class Array
 def exclude?(v);!include?(v);end
 def many?;length>1;end
 def to_sentence(two_words_connector:,last_word_connector:);length<3 ? join(two_words_connector) : self[0...-1].join(', ')+last_word_connector+last;end
end
module Money;class Currency;def self.all;$codes.to_h{|x|[x.downcase,true]};end;end;end
class Query
 def initialize(values);@values=values;end
 def distinct;Query.new(@values.uniq);end
 def order(*);Query.new(@values.sort);end
 def pluck(*);@values;end
 def where(*);self;end
 def not(*);self;end
end
class Trade;def self.joins(*);Query.new($input['trades']);end;end
class Holding;def self.where(**);Query.new($input['holdings']);end;end
module Arel;def self.sql(x);x;end;end
class Security
 def id;'s';end
 class Price
  def self.upsert_all(rows,**);$written=rows;Struct.new(:rows).new(rows.map{[true]});end
 end
 def cash?;$input['cash'];end
 def offline?;true;end
 def offline_reason;nil;end
 def price_provider;nil;end
 def prices;Query.new($input['prices']);end
 def with_lock;yield;end
end
class Accounts;def select(*);['a'];end;end
load File.join(ARGV[0],'app/models/security/manual_price_import.rb')
payload=JSON.parse(STDIN.read);$codes=payload['codes'];puts JSON.generate(payload['inputs'].map do |input|
 $input=input;$written=[]
 begin
  Security::ManualPriceImport.new(security:Security.new,rows:input['rows'],accounts:Accounts.new).import!
  {errors:[],parsed:$written.map{|r|{date:r[:date].to_s,price:r[:price].to_s('F'),currency:r[:currency]}}}
 rescue Security::ManualPriceImport::Invalid=>e
  {errors:e.errors,parsed:[]}
 end
end)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify({codes:CURRENCIES,inputs}),encoding:'utf8',maxBuffer:1000000}));let checks=0;
for(const [i,input] of inputs.entries()){const state={...structuredClone(emptyState),profile:{ownerId:'one',name:'Pinned',currency:'USD',revision:0},securities:[{id:'s',ownerId:'one',ticker:'ABC',name:'ABC',exchange:'',kind:input.cash?'cash':'standard',websiteUrl:null}],securityPrices:input.prices.map((currency,j)=>({id:'p'+j,ownerId:'one',securityId:'s',date:'2025-01-01',price:'1',currency})),trades:input.trades.map(currency=>({securityId:'s',currency})),holdingSnapshots:input.holdings.map(currency=>({securityId:'s',currency}))},v=validateDailyPrices(state,'s',input.rows,'2026-03-01');checks++;assert.deepEqual(v.errors,actual[i].errors,'fixture '+i+' '+JSON.stringify(input));if(!v.errors.length){checks++;assert.deepEqual(v.parsed.map(r=>({date:r.date,price:r.price,currency:r.currency})),actual[i].parsed.map(r=>({...r,price:r.price.replace(/\.0$/,'').replace(/(\.\d*?)0+$/,'$1')})),'normalized fixture '+i);}}
console.log(`${checks} pinned Ruby ManualPriceImport validation, currency precedence and complete parsed-write comparisons passed (actual class with relation/upsert stubs; not full Rails SQL/provider resolution).`);
