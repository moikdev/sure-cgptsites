import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,ACCOUNT_TYPES} from '../lib/finance.ts';import {createScheduledProjection} from '../lib/scheduled-projection.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const names={checking:'Depository',savings:'Depository',credit:'CreditCard',investment:'Investment',crypto:'Crypto',property:'Property',vehicle:'Vehicle',loan:'Loan',other_liability:'OtherLiability',other:'OtherAsset'},asOf='2026-01-31',cases=[];
for(let i=0;i<600;i++){const type=ACCOUNT_TYPES[i%10],currency=['USD','JPY','KWD'][i%3],sign=['credit','loan','other_liability'].includes(type)?-1:1,base=sign*(10000+i),s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Source',currency,revision:0},accounts:[{id:'a',ownerId:'one',name:'Account',type,currency,openingBalance:base,openingDate:'2020-01-01',archived:i%2}]},source=[];for(let j=0;j<20;j++){const date=new Date(Date.UTC(2026,0,30+j)).toISOString().slice(0,10),amount=j%7===0?0:(j%2?1:-1)*(1+(i*73+j*31)%5000),kind=j%4===0?'Trade':'Transaction',qty=kind==='Trade'?(j%8===0?'1':'0'):'0';source.push({date,amount:-amount,type:kind,qty,splitParent:false,pending:false,customRate:j%3===0?'1.25':null});if(kind==='Trade'){if(!s.securities.length)s.securities.push({id:'sec',ownerId:'one',ticker:'ABC',name:'Example',exchange:'',kind:'standard',websiteUrl:null});s.trades.push({id:'tr'+j,ownerId:'one',accountId:'a',securityId:'sec',date,name:'Trade',qty,price:'1',cashAmount:amount,fee:qty==='0'?0:15,currency,activity:qty==='0'?'cash':'buy',sequence:j,notes:'',importKey:null});}else s.transactions.push({id:'t'+j,ownerId:'one',accountId:'a',date,amount,name:'Entry',categoryId:null,kind:'standard',excluded:j%2,transferId:null,notes:'',importKey:null});}
// Current base is supplied by the existing physical valuation reader. Keep pre-base trade/tx effects in the independent adapter base.
const r=createScheduledProjection(s,'a',asOf);source.push({date:'2026-02-03',amount:999999,type:'Valuation',qty:'0',splitParent:false,pending:false},{date:'2026-02-04',amount:999999,type:'Transaction',qty:'0',splitParent:true,pending:false},{date:'2026-02-05',amount:999999,type:'Transaction',qty:'0',splitParent:false,pending:true});cases.push({type,nativeType:names[type],asset:sign===1,base:r.current.amount,source,state:s,horizons:[asOf,'2026-02-01','2026-02-09','2026-03-01']});}
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal'
class Date;def self.current;Date.new(2026,1,31);end;end
def method_source(path,wanted)
 text=File.read(path);found={};walk=->(node){if node.is_a?(RubyVM::AbstractSyntaxTree::Node);if node.type==:DEFN && wanted.include?(node.children[0]);found[node.children[0]]=text.lines[(node.first_lineno-1)..(node.last_lineno-1)].join;end;node.children.each{|c|walk.call(c)};end};walk.call(RubyVM::AbstractSyntaxTree.parse(text));raise 'Missing source methods' unless found.length==wanted.length;found
end
class Money
 class ConversionError<StandardError;end
 attr_reader :amount
 def initialize(amount,currency,convertible=true,custom=nil);@amount=amount;@currency=currency;@convertible=convertible;@custom=custom;end
 def +(other);Money.new(amount+other.amount,@currency);end
 def exchange_to(currency,date:,custom_rate:);raise ConversionError unless @convertible;raise 'custom exchange rate was not forwarded' unless custom_rate==@custom;Money.new(amount,currency);end
end
class Relation
 include Enumerable
 def initialize(rows);@rows=rows;end
 def each(&block);@rows.each(&block);end
 def excluding_pending;Relation.new(@rows.reject(&:pending));end
 def excluding_split_parents;Relation.new(@rows.reject(&:split_parent));end
 def where(*args)
  if args[0].is_a?(Hash);Relation.new(@rows.select{|r|args[0][:entryable_type].include?(r.entryable_type)})
  else;Relation.new(@rows.select{|r|r.date>args[1]});end
 end
 def includes(*);self;end
end
Trade=Struct.new(:qty,:exchange_rate)
Entry=Struct.new(:date,:entryable_type,:entryable,:amount_money,:pending,:split_parent)
class SourceAccount
 attr_accessor :accountable_type,:currency,:entries,:balance_money,:is_asset
 def asset?;is_asset;end
end
method_source(File.join(ARGV[0],'app/models/account.rb'),[:balance_type,:scheduled_entries_total_money,:projected_balance_money,:scheduled_entry_flows,:convert_scheduled_entry_amount]).each_value{|s|SourceAccount.class_eval(s)}
class SourceFeed;attr_accessor :account;end
method_source(File.join(ARGV[0],'app/models/account/activity_feed_data.rb'),[:projected_balance_money_for]).each_value{|s|SourceFeed.class_eval(s)}
input=JSON.parse(STDIN.read);values=input.map do |c|
 sign=c['asset'] ? 1 : -1;a=SourceAccount.new;a.accountable_type=c['nativeType'];a.currency=c['state']['accounts'][0]['currency'];a.is_asset=c['asset'];a.balance_money=Money.new(c['base']*sign,a.currency);a.entries=Relation.new(c['source'].map{|r|Entry.new(Date.parse(r['date']),r['type'],Trade.new(BigDecimal(r['qty']),r['customRate']),Money.new(r['amount'],a.currency,true,r['customRate']),r['pending'],r['splitParent'])});feed=SourceFeed.new;feed.account=a
 horizons=c['horizons'].map{|d|date=Date.parse(d);raw=a.scheduled_entries_total_money(through_date:date).amount*sign;proj=(a.balance_money+a.scheduled_entries_total_money(through_date:date)).amount*sign;f=feed.projected_balance_money_for(date);raise 'Feed is not nil on actual date' if date<=Date.current && f;raise 'Feed differs on future date' if f && f.amount*sign!=proj;[raw,proj]}
 {horizons:horizons,all:a.projected_balance_money.amount*sign}
end
probe=SourceAccount.new;probe.currency='USD';probe.is_asset=true
entry=Entry.new(Date.new(2026,2,1),'Trade',Trade.new(BigDecimal('0'),'1.25'),Money.new(1000,'USD',false,'1.25'),false,false)
raise 'Missing FX was not omitted by source' unless probe.convert_scheduled_entry_amount(entry).nil?
entry.amount_money=Money.new(900,'USD',true,'1.25');raise 'Custom converted cash sign differs' unless probe.convert_scheduled_entry_amount(entry)==-900
entry.entryable.qty=BigDecimal('1');entry.amount_money=Money.new(1000,'USD',false,'1.25');raise 'Security movement tried conversion' unless probe.convert_scheduled_entry_amount(entry).nil?
puts JSON.generate(values)
`;
const expected=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8e6}));for(let i=0;i<cases.length;i++){const c=cases[i];for(let j=0;j<c.horizons.length;j++){const r=createScheduledProjection(c.state,'a',asOf,c.horizons[j]);assert.deepEqual([r.scheduledChange.amount,r.projected.amount],expected[i].horizons[j],`${i} ${c.type} ${c.horizons[j]}`);}assert.equal(createScheduledProjection(c.state,'a',asOf).projected.amount,expected[i].all);}
console.log(`PASS ${cases.length} scenarios/${cases.length*4} date cutoffs over all 10 account types and USD/JPY/KWD executing pinned Account scheduled-entry/type/conversion/total/projection methods and ActivityFeedData future-date helper. Controlled relations exclude pending, split parents and valuations; source signed liabilities normalize to port NAV. Base values and already-normalized applied FX use controlled adapters, not full Rails SQL, rate lookup or full activity-feed rendering.`);
