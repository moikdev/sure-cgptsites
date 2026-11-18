import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {emptyState} from '../lib/finance.ts';import {planHoldingRemoval} from '../lib/holding-removal.ts';
const root='/tmp/sure-upstream-port-reference',sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(sha,'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const source=readFileSync(root+'/app/models/holding.rb','utf8'),start=source.indexOf('  def destroy_holding_and_entries!'),end=source.indexOf('\n  end',start)+6,method=source.slice(start,end);assert.ok(method.includes('account.entries.where(entryable: account.trades.where(security: security)).destroy_all'));assert.ok(method.includes('account.sync_later'));
let seed=62891;const random=n=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)%n;},cases=[];
for(let i=0;i<200;i++){const accounts=['a','b','c'].map(id=>({id,ownerId:'one',name:id,type:'investment',currency:'USD',openingBalance:100000,openingDate:'2026-01-01',archived:0})),securities=['s','x','z'].map(id=>({id,ownerId:'one',ticker:id.toUpperCase(),name:id,exchange:'XNYS',kind:'standard',websiteUrl:null})),holdings=accounts.flatMap(a=>securities.flatMap(s=>['2026-01-03','2026-01-11'].map(date=>({id:'h:'+a.id+':'+s.id+':'+date,ownerId:'one',accountId:a.id,securityId:s.id,date,qty:'2',price:'10',amount:2000,currency:'USD',costBasis:'5',costBasisSource:'manual',costBasisLocked:1,securityLocked:0})))),holdingId=holdings[random(holdings.length)].id,trades=Array.from({length:i===0?0:random(250)},(_,j)=>({id:'t'+j,ownerId:'one',accountId:accounts[random(3)].id,securityId:securities[random(3)].id,date:j%13===0?'2199-01-01':'2026-01-'+String(random(28)+1).padStart(2,'0'),name:'Trade '+j,qty:'0',price:'0',fee:0,cashAmount:random(2)?10:-10,currency:'USD',activity:'cash',sequence:j,notes:'',importKey:null,...(j%7===0?{excluded:1}:{})}));cases.push({holdingId,accounts,securities,holdings,trades});}
const ruby=String.raw`
require 'json';require 'set'
class Relation
 attr_reader :rows
 def initialize(rows);@rows=rows;end
 def where(**args)
  Relation.new(@rows.select{|r|args.all?{|key,v|key==:security ? r['securityId']==v : key==:entryable ? v.rows.any?{|t|t['id']==r['id']} : false}})
 end
 def destroy_all
  ids=@rows.map{|r|r['id']}.to_set;$trades.reject!{|r|ids.include?(r['id'])}
 end
end
class Account
 def initialize(id);@id=id;end
 def trades;Relation.new($trades.select{|r|r['accountId']==@id});end
 def entries;trades;end
 def sync_later;$syncs+=1;end
end
class Holding
 def initialize(row);@row=row;end
 def account;Account.new(@row['accountId']);end
 def security;@row['securityId'];end
 def transaction;yield;end
 def destroy;$holdings.reject!{|r|r['id']==@row['id']};end
end
Holding.class_eval(JSON.parse(STDIN.readline))
inputs=JSON.parse(STDIN.read);out=inputs.map do |input|
 $holdings=input['holdings'];$trades=input['trades'];$syncs=0;row=$holdings.find{|r|r['id']==input['holdingId']};Holding.new(row).destroy_holding_and_entries!;{holdings:$holdings.map{|r|r['id']}.sort,trades:$trades.map{|r|r['id']}.sort,syncs:$syncs}
end;STDOUT.write(JSON.generate(out))
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby],{input:JSON.stringify(method)+'\n'+JSON.stringify(cases),encoding:'utf8',maxBuffer:4000000}));let removed=0;
for(const [i,c] of cases.entries()){const s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Test',currency:'USD',revision:0},accounts:c.accounts,securities:c.securities,holdingSnapshots:c.holdings,trades:c.trades},p=planHoldingRemoval(s,c.holdingId,'2026-01-31');assert.deepEqual({holdings:p.next.holdingSnapshots.map(h=>h.id).sort(),trades:p.next.trades.map(t=>t.id).sort(),syncs:1},actual[i],'pinned method case '+i);removed+=p.trades.length;assert.equal(p.next.holdingSnapshots.length,c.holdings.length-1);}
const result={sha,methodSHA256:createHash('sha256').update(method).digest('hex'),cases:cases.length,removedTrades:removed,notes:'Actual pinned Holding#destroy_holding_and_entries! body through controlled account/trade/entry relations. Exact record scope and one queued sync are compared. Port recomputes derived reports synchronously; this is not full ActiveRecord callbacks, materialization or lot execution.'};writeFileSync('outputs/holding-removal-differential.json',JSON.stringify(result,null,2));console.log(`Pinned holding destroy method matched ${cases.length} controlled cases and ${removed} removed trades; selected observation only, all dates/excluded activities, other accounts/securities retained and one source sync.`);
