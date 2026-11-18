import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,isValuationOnlyType,ACCOUNT_TYPES,accountBalance} from '../lib/finance.ts';import {createValueAccountingReport} from '../lib/value-accounting.ts';import {createHistoricalValuationReader} from '../lib/historical-valuation.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const names={checking:'Depository',savings:'Depository',credit:'CreditCard',investment:'Investment',crypto:'Crypto',property:'Property',vehicle:'Vehicle',loan:'Loan',other_liability:'OtherLiability',other:'OtherAsset'},cases=[];for(let i=0;i<600;i++){const type=['other','other_liability','property','vehicle'][i%4],sign=type==='other_liability'?-1:1,s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Source',currency:['USD','JPY','KWD'][i%3],revision:0},accounts:[{id:'a',ownerId:'one',name:'Value',type,currency:['USD','JPY','KWD'][i%3],openingBalance:sign*((i*431)%100000-1000),openingDate:'2020-01-01',archived:i%2,excludedFromReports:i%2}]};for(let j=0;j<20;j++)s.transactions.push({id:'t'+j,ownerId:'one',accountId:'a',categoryId:null,date:new Date(Date.UTC(2020,j%12,1+j%28)).toISOString().slice(0,10),amount:j%7===0?0:(j%2?1:-1)*((i*73+j*31)%5000),name:'Movement',kind:j%3?'one_time':'standard',transferId:null,notes:'',importKey:null,excluded:j%2});if(i%3!==0)s.valuations.push({id:'v',ownerId:'one',accountId:'a',date:'2020-06-10',amount:sign*((i*611)%100000-1000),name:'Observed',kind:'history'});s.valuations.push({id:'future',ownerId:'one',accountId:'a',date:'2027-01-01',amount:1,name:'Future',kind:'history'});cases.push({type,nativeType:names[type],sign,state:s,dates:['2019-12-31','2020-01-01','2020-06-09','2020-06-10','2020-12-31','2026-10-16']});}
const ruby=String.raw`
require 'json';require 'date'
# Extract exact pinned methods; avoid loading Rails application callbacks.
def method_source(path,wanted)
 text=File.read(path);found={};walk=->(node){if node.is_a?(RubyVM::AbstractSyntaxTree::Node);if node.type==:DEFN && wanted.include?(node.children[0]);found[node.children[0]]=text.lines[(node.first_lineno-1)..(node.last_lineno-1)].join;end;node.children.each{|c|walk.call(c)};end};walk.call(RubyVM::AbstractSyntaxTree.parse(text));raise 'Missing methods' unless found.length==wanted.length;found
end
class SourceAccount;attr_accessor :accountable_type;end
method_source(File.join(ARGV[0],'app/models/account.rb'),[:balance_type]).each_value{|s|SourceAccount.class_eval(s)}
class SourceCalculator
 attr_accessor :account,:sync_cache
 def signed_entry_flows(*);raise 'Non-cash account must not apply transaction sums';end
 def holdings_value_for_date(*);raise 'Non-cash account must not reprice holdings';end
end
method_source(File.join(ARGV[0],'app/models/balance/base_calculator.rb'),[:flows_for_date,:derive_cash_balance,:derive_non_cash_balance]).each_value{|s|SourceCalculator.class_eval(s)}
Entry=Struct.new(:amount,:date){def transaction?;true;end;def trade?;false;end}
Cache=Struct.new(:rows){def get_entries(date);rows.select{|r|r.date==date};end}
input=JSON.parse(STDIN.read);types=input['names'].transform_values{|n|a=SourceAccount.new;a.accountable_type=n;a.balance_type.to_s}
values=input['cases'].map do |c|
 a=SourceAccount.new;a.accountable_type=c['nativeType'];calc=SourceCalculator.new;calc.account=a;calc.sync_cache=Cache.new(c['state']['transactions'].map{|t|Entry.new(-t['amount'],t['date'])});opening=c['state']['accounts'][0];observed=c['state']['valuations'];dates=c['dates'];events=([opening['openingDate']]+c['state']['transactions'].map{|t|t['date']}+observed.map{|v|v['date']}+dates).uniq.sort;noncash=0;answers={}
 events.each do |date|
  next if date>dates.max
  noncash=opening['openingBalance']*c['sign'] if date==opening['openingDate'];v=observed.find{|v|v['date']==date};noncash=v['amount']*c['sign'] if v
  flows=calc.flows_for_date(date);raise 'Source applied non-cash transaction movement' unless flows.values.all?(&:zero?);raise 'Source supplied cash' unless calc.derive_cash_balance(0,date)==0
  forward=calc.derive_non_cash_balance(noncash,date);reverse=calc.derive_non_cash_balance(noncash,date,direction: :reverse);raise 'Source forward/reverse disagreed' unless forward==reverse;noncash=forward;answers[date]=noncash*c['sign'] if dates.include?(date)
 end
 dates.map{|d|answers.fetch(d)}
end
puts JSON.generate({types:types,values:values})
`;
const source=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify({names,cases}),encoding:'utf8',maxBuffer:8e6}));for(const type of ACCOUNT_TYPES)assert.equal(isValuationOnlyType(type),source.types[type]==='non_cash'&&type!=='loan');for(let i=0;i<cases.length;i++){const c=cases[i],reader=createHistoricalValuationReader(c.state,c.dates.at(-1));for(let j=0;j<c.dates.length;j++){const date=c.dates[j],expected=source.values[i][j];assert.equal(accountBalance(c.state.accounts[0],c.state,date),expected,`physical ${i} ${date}`);assert.equal(reader.read('a',date).total,expected,`indexed ${i} ${date}`);if(['other','other_liability'].includes(c.type))assert.equal(createValueAccountingReport(c.state,'a',date).current.amount,expected,`review ${i} ${date}`);}}
console.log(`PASS ${ACCOUNT_TYPES.length} account-type rules and ${cases.length} source non-cash scenarios/${cases.length*cases[0].dates.length} dates across USD/JPY/KWD, executing actual pinned Account#balance_type and BaseCalculator cash/non-cash/flow methods in both directions; physical engine, indexed history and accounting review agree. Entry/cache/valuation chronology use controlled adapters, not full Rails SQL.`);
