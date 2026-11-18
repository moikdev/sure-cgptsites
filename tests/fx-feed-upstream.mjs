import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {emptyState} from '../lib/finance.ts';import {planFxFeed,frankfurterURL,addFeedDays} from '../lib/fx-feed.ts';import {csvDigest} from '../lib/csv-digest.ts';
const root='/tmp/sure-upstream-port-reference',sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(sha,'d194118a3b80cd3f88d111e73ff5f6255c42c22b');let seed=1234321;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;},options={fromCurrency:'USD',toCurrency:'EUR',startDate:'2026-01-10',endDate:'2026-01-24'},cases=[];
for(let i=0;i<180;i++){const provider=[],db=[];for(let day=-5;day<=14;day++){const date=addFeedDays(options.startDate,day);if(random(4)===0)provider.push({date,base:'USD',quote:'EUR',rate:["0.123456789012345678","0.9","1.25","3","6","12345.67"][random(6)]});if(day>=0&&random(5)===0)db.push({date,rate:['0.2','0.5','2','4'][random(4)]});}cases.push({provider,db});}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'set';require 'logger';require 'ostruct'
class Object;def blank?;respond_to?(:empty?) ? empty? : !self;end;def present?;!blank?;end;end
class Integer;def days;self;end;end
class Array;def index_by;to_h{|v|[yield(v),v]};end;end
module Rails;def self.logger;@logger||=Logger.new(File::NULL);end;end
module Sentry;def self.capture_exception(*);end;end
class Query
 def initialize(rows);@rows=rows;end
 def order(*);Query.new(@rows.sort_by(&:date));end
 def to_a;@rows;end
 def pluck(key);@rows.map{|r|r.send(key)};end
 def count;@rows.length;end
end
class ExchangeRate
 def self.valid_rate?(r);r.finite?&&r>0;end
 def self.where(**args);Query.new($db.values.select{|r|args.all?{|key,v|v.is_a?(Range) ? v.cover?(r.send(key)) : r.send(key)==v}});end
 def self.upsert_all(rows,**);rows.each{|r|$db[[r[:from_currency],r[:to_currency],r[:date]]]=OpenStruct.new(r)};rows.map{|r|r[:date]};end
end
class ExchangeRatePair
 def self.for_pair(**);OpenStruct.new(first_provider_rate_on:nil);end
 def self.record_first_provider_rate_on(**);end
end
load ARGV[0]+'/app/models/exchange_rate/importer.rb'
class Runner < ExchangeRate::Importer
 private
 def normalize_end_date(d);d;end
 def current_provider_name;'frankfurter';end
end
class Provider
 def fetch_exchange_rates(**);OpenStruct.new(success?:true,data:$provider);end
end
inputs=JSON.parse(STDIN.read);out=inputs.map do |input|
 $db={};input['db'].each{|r|v=OpenStruct.new(from_currency:'USD',to_currency:'EUR',date:Date.iso8601(r['date']),rate:r['rate']);$db[['USD','EUR',v.date]]=v}
 $provider=input['provider'].map{|r|OpenStruct.new(date:Date.iso8601(r['date']),rate:r['rate'])}
 Runner.new(exchange_rate_provider:Provider.new,from:'USD',to:'EUR',start_date:Date.iso8601('2026-01-10'),end_date:Date.iso8601('2026-01-24'),clear_cache:true).import_provider_rates
 $db.values.map{|r|[r.date.iso8601,r.from_currency,r.to_currency,BigDecimal(r.rate.to_s).to_s('F').sub(/\.0+$/,'').sub(/(\.\d*?)0+$/,'\1')]}.sort
end;STDOUT.write(JSON.generate(out))
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:4000000}));let quotes=0;
for(const [i,c] of cases.entries()){const body=JSON.stringify(c.provider),source={format:'sure-frankfurter-source',version:1,id:'b208329a-b726-4245-842b-c7b089b64a25',options,url:frankfurterURL(options),fetchedAt:'2026-11-01T00:00:00.000Z',rawSha256:await csvDigest(body),rawBytes:body.length,body},state={...structuredClone(emptyState),profile:{ownerId:'one',name:'Test',currency:'USD',revision:0},exchangeRates:c.db.map((r,j)=>({id:'db-'+j,ownerId:'one',fromCurrency:'USD',toCurrency:'EUR',notes:'',...r}))},p=await planFxFeed(state,source,'replace',true),rows=p.next.exchangeRates.map(r=>[r.date,r.fromCurrency,r.toCurrency,r.rate]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));assert.deepEqual(rows,actual[i].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))),'source case '+i);quotes+=rows.length;}
writeFileSync('outputs/fx-feed-differential.json',JSON.stringify({sha,cases:cases.length,quotes,mode:'explicit full-fetch / source clear_cache:true; replace; inverse',notes:'Owner-private sources, receipt approval, keep policy, UTC cutoff, exact numeric token preservation, explicit inverse toggle and bounds are port-specific extensions; provider fetch/cache-on-read jobs and global pair metadata are excluded.'},null,2));console.log(`Actual pinned ExchangeRate::Importer differential: ${cases.length} cases and ${quotes} exact dated quotes matched, including lookback, DB fallback, missing anchors, carry and 12-place inverses.`);
