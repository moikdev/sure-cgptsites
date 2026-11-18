import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {transferMatchCandidates} from '../lib/transfer-match.ts';
const root='/tmp/sure-upstream-port-reference',cases=[];let seed=21;const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let n=0;n<600;n++){
 const category=n%3===0?null:'c0',s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Oracle',currency:'USD',revision:1},accounts:[['source','USD'],['usd','USD'],['eur','EUR']].map(([id,currency])=>({id,ownerId:'one',name:id,type:'checking',currency,openingBalance:0,openingDate:'2026-01-01',archived:0})),exchangeRates:[{id:'r',ownerId:'one',date:'2026-02-01',fromCurrency:'USD',toCurrency:'EUR',rate:'1',notes:''}],transactions:[{id:'source',ownerId:'one',accountId:'source',categoryId:category,date:'2026-02-01',name:'Outflow',amount:-10000,kind:'standard',transferId:null,notes:'',importKey:null}]};const rows=[];
 for(let i=0;i<12;i++){const id='c'+String(i).padStart(2,'0'),sameCurrency=next()%2===0,days=next()%5,categoryId=[null,'c0','c1'][next()%3],rejected=next()%3===0;s.transactions.push({id,ownerId:'one',accountId:sameCurrency?'usd':'eur',categoryId,date:'2026-02-'+String(1+days).padStart(2,'0'),name:id,amount:10000,kind:'standard',transferId:null,notes:'',importKey:null});rows.push({id,categoryId,sameCurrency,days,rejected});if(rejected)s.transferMatchRejections.push({id:'r'+i,ownerId:'one',outflowTransactionId:i%2?'source':id,inflowTransactionId:i%2?id:'source',createdAt:null,updatedAt:null});}
 const initial=rows.slice().sort((a,b)=>Number(b.sameCurrency)-Number(a.sameCurrency)||a.days-b.days||a.id.localeCompare(b.id));cases.push({category,initial,categories:rows.map(r=>[r.id,r.categoryId]),rejected:rows.filter(r=>r.rejected).map(r=>r.id),expected:transferMatchCandidates(s,'source').map(c=>c.transactionId)});
}
const ruby=String.raw`
require 'json'
module ActiveSupport; module Concern; def included(base=nil,&block); end; end; end
class Transaction
 def self.where(id:); Struct.new(:rows){def pluck(*args);rows;end}.new($categories.select{|key,value|id.include?(key)}.to_a); end
end
class RejectedTransfer
 def self.where(**filters); Struct.new(:ids){def pluck(*args);ids;end}.new(filters.key?(:inflow_transaction_id) ? $rejected : []); end
end
class Family; end
load File.join(ARGV[0],'app/models/transaction/transferable.rb')
load File.join(ARGV[0],'app/models/family/auto_transfer_matchable.rb')
class Probe
 include Transaction::Transferable
 def id; 'source';end
 def category_id; $category;end
end
Row=Struct.new(:outflow_transaction_id,:inflow_transaction_id)
rows=JSON.parse(STDIN.read).map do |c|
 $category=c['category'];$categories=c['categories'].to_h;$rejected=c['rejected']
 Probe.new.send(:likeliest_first,c['initial'].map{|row|Row.new('source',row['id'])}).map(&:inflow_transaction_id)
end
puts JSON.generate({rows:rows,window:Family::AutoTransferMatchable::TRANSFER_HINT_DATE_WINDOW,tolerance:Family::AutoTransferMatchable::TRANSFER_HINT_EXCHANGE_RATE_TOLERANCE})
`;
const result=spawnSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8000000});assert.equal(result.status,0,result.stderr);const actual=JSON.parse(result.stdout);assert.equal(actual.window,2);assert.equal(actual.tolerance,0.03);assert.equal(actual.rows.length,cases.length);for(let i=0;i<cases.length;i++)assert.deepEqual(actual.rows[i],cases[i].expected,'Original Ruby ordering case '+i);
console.log(`Matched ${cases.length} original Ruby Transaction::Transferable ordering cases and the source hint date/tolerance constants.`);
