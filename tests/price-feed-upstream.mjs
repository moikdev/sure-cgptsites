import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {emptyState,today} from '../lib/finance.ts';import {priceFeedOptions,yahooPriceURL,planPriceFeed} from '../lib/price-feed.ts';import {addFeedDays} from '../lib/fx-feed.ts';import {csvDigest} from '../lib/csv-digest.ts';
const root='/tmp/sure-upstream-port-reference',sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(sha,'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const asOf=today(),security={id:'b208329a-b726-4245-842b-c7b089b64a25',ownerId:'one',ticker:'ABC',name:'Test',exchange:'XNYS',kind:'standard',websiteUrl:null};let seed=72893;const random=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)%n;},cases=[];
for(let i=0;i<180;i++){const start=i<120?'2026-01-10':addFeedDays(asOf,-14),end=addFeedDays(start,14),provider=[],db=[];for(let day=-7;day<=14;day++){const date=addFeedDays(start,day);if(random(4)===0)provider.push({date,price:['0.1','12.12345','7','999.9999'][random(4)],currency:'USD'});if(day>=0&&random(5)===0)db.push({date,price:['0','2','4','8'][random(4)],currency:'USD'});}cases.push({start,end,provider,db,asOf});}
cases.push(...[
 {provider:[{date:'2026-01-12',price:'2',currency:'USD'}],db:[]},
 {provider:[{date:'2026-01-12',price:'2',currency:'USD'}],db:[{date:'2026-01-10',price:'3',currency:'USD'}]},
 {provider:[],db:[{date:'2026-01-10',price:'3',currency:'USD'}]},
 {provider:[{date:'2026-01-09',price:'12.12345',currency:'USD'}],db:[{date:'2026-01-10',price:'8',currency:'USD'},{date:'2026-01-12',price:'7',currency:'USD'}]},
 {provider:[{date:'2026-01-11',price:'3',currency:'USD'}],db:[{date:'2026-01-10',price:'0',currency:'USD'}]}
].map(c=>({...c,start:'2026-01-10',end:'2026-01-24',asOf})));
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'logger';require 'ostruct';require 'set'
class Object;def blank?;respond_to?(:empty?) ? empty? : !self;end;def present?;!blank?;end;end
class String;def demodulize;split('::').last;end;end
class Integer;def days;self;end;def ago;Date.current-self;end;end
class Date;def self.current;Date.iso8601($input['asOf']);end;def to_date;self;end;end
class Time;def self.current;Time.now;end;end
class Array;def index_by;to_h{|v|[yield(v),v]};end;end
module Rails;def self.logger;@logger||=Logger.new(File::NULL);end;end
module Sentry;def self.capture_exception(*);end;end
module DebugLogEntry;def self.capture(**);end;end
class Query
 def initialize(rows);@rows=rows;end
 def order(*);Query.new(@rows.sort_by(&:date));end
 def to_a;@rows;end
 def count;@rows.length;end
end
class Security
 attr_accessor :id,:ticker,:exchange_operating_mic,:first_provider_price_on
 def initialize;@id='security';@ticker='ABC';end
 def update_column(key,value);send(key.to_s+'=',value);end
 def self.clear_plan_restriction(*,**);end
 class Price
  def self.where(**args);Query.new($db.values.select{|r|args.all?{|key,v|v.is_a?(Range) ? v.cover?(r.send(key)) : r.send(key)==v}});end
  def self.upsert_all(rows,**);rows.each{|r|r=r.merge(price:BigDecimal(r[:price].to_s).round(4));$db[[r[:date],r[:currency]]]=OpenStruct.new(r)};rows.map{|r|r[:date]};end
 end
end
load ARGV[0]+'/app/models/security/price/importer.rb'
class Runner < Security::Price::Importer
 private
 def normalize_end_date(d);d;end
end
class Provider
 def max_history_days;3652;end
 def fetch_security_prices(**);OpenStruct.new(success?:true,data:$provider);end
end
out=JSON.parse(STDIN.read).map do |input|
 $input=input;$db={};input['db'].each{|r|v=OpenStruct.new(security_id:'security',date:Date.iso8601(r['date']),price:r['price'],currency:r['currency'],provisional:false);$db[[v.date,v.currency]]=v};$provider=input['provider'].map{|r|OpenStruct.new(date:Date.iso8601(r['date']),price:r['price'],currency:r['currency'])};Runner.new(security:Security.new,security_provider:Provider.new,start_date:Date.iso8601(input['start']),end_date:Date.iso8601(input['end']),clear_cache:true).import_provider_prices
 $db.values.map{|r|[r.date.iso8601,r.currency,BigDecimal(r.price.to_s).to_s('F').sub(/\.0+$/,'').sub(/(\.\d*?)0+$/,'\1')]}.sort
end;STDOUT.write(JSON.generate(out))
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:4000000}));let quotes=0;
for(const [i,c] of cases.entries()){const options=priceFeedOptions(security,{securityId:security.id,startDate:c.start,endDate:c.end}),body=JSON.stringify({chart:{error:null,result:[{meta:{symbol:'ABC',currency:'USD'},timestamp:c.provider.map(r=>Date.parse(r.date+'T12:00:00Z')/1000),indicators:{quote:[{close:c.provider.map(r=>r.price)}]}}]}}),source={format:'sure-yahoo-price-source',version:1,id:'b2a9ef2e-007d-49cd-88d7-c19c1ea1086c',options,url:yahooPriceURL(options),fetchedAt:'2026-11-01T00:00:00.000Z',rawSha256:await csvDigest(body),rawBytes:body.length,body},s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Test',currency:'USD',revision:0},securities:[security],securityPrices:c.db.map((r,j)=>({id:'db-'+j,ownerId:'one',securityId:security.id,...r}))},p=await planPriceFeed(s,source,'replace',asOf),rows=p.next.securityPrices.map(r=>[r.date,r.currency,r.price]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));assert.deepEqual(rows,actual[i].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),'source case '+i);quotes+=rows.length;}
writeFileSync('outputs/price-feed-differential.json',JSON.stringify({sha,cases:cases.length,quotes,mode:'Actual Security::Price::Importer; clear_cache:true; replacement; positive provider observations; four-place DB adapter',notes:'Private ownership/source/audit, keep-existing option, exact numeric tokens, invalid-row diagnostics and honest UTC/source bounds are port extensions. Full Rails and successful live provider fetch are not exercised.'},null,2));console.log(`Actual pinned security price importer matched ${cases.length} controlled cases and ${quotes} exact dated prices, including DB start fallback, honest IPO gaps, source clear-range carry and recent-date windows.`);
