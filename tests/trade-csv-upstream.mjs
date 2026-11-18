import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {planTradeCSVRevert} from '../lib/trade-csv-revert.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const base={accounts:['existing','created','surviving'],trades:[{id:'owned-existing',accountId:'existing',qty:'1'},{id:'owned-created',accountId:'created',qty:'1'},{id:'later-created',accountId:'created',qty:'1'},{id:'retained',accountId:'existing',qty:'1'}],transactions:[{id:'later-cash',accountId:'created'},{id:'keep-cash',accountId:'surviving'}],ownedTrades:['owned-existing','owned-created'],ownedAccounts:['created']},fixtures=[base,{...base,ownedAccounts:[]},{...base,ownedTrades:[]},{...base,ownedTrades:[],ownedAccounts:[]},{...base,ownedTrades:['missing'],ownedAccounts:['missing']},{...base,trades:base.trades.filter(t=>!t.id.startsWith('owned'))},{...base,trades:base.trades.map(t=>t.id==='owned-existing'?{...t,qty:'2'}:t)},{...base,trades:base.trades.map(t=>t.id==='owned-existing'?{...t,accountId:'surviving'}:t)}];
const ruby=String.raw`
require 'json'
class Import
 class << self;attr_accessor :trace;def transaction;trace<<'begin';yield;trace<<'commit';end;end
 attr_accessor :accounts,:entries,:family,:status
 def update!(status:,**);self.status=status;Import.trace<<'status';end
end
source=File.read(File.join(ARGV[0],'app/models/import.rb'));Import.class_eval(source[/  def revert\n.*?\n  end/m]);Import.class_eval(source[/    def revert_derived_state!\n.*?\n    end/m]);Import.class_eval(source[/    def status_after_revert\n.*?\n    end/m]);load File.join(ARGV[0],'app/models/trade_import.rb')
class Accounts
 def initialize(state,ids);@state=state;@ids=ids;end
 def destroy_all;Import.trace<<'accounts';@state['accounts'].reject!{|id|@ids.include?(id)};%w[trades transactions].each{|key|@state[key].reject!{|r|@ids.include?(r['accountId'])}};end
end
class Entries
 def initialize(state,ids);@state=state;@ids=ids;end
 def destroy_all;Import.trace<<'entries';@state['trades'].reject!{|r|@ids.include?(r['id'])};end
end
class Family;def sync_later;Import.trace<<'sync';end;end
puts JSON.generate(JSON.parse(STDIN.read).map do |input|
 state=Marshal.load(Marshal.dump(input));Import.trace=[];m=TradeImport.new;m.accounts=Accounts.new(state,input['ownedAccounts']);m.entries=Entries.new(state,input['ownedTrades']);m.family=Family.new;m.revert;{accounts:state['accounts'].sort,trades:state['trades'].map{|r|r['id']}.sort,transactions:state['transactions'].map{|r|r['id']}.sort,status:m.status,trace:Import.trace}
end)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(fixtures),encoding:'utf8'}));let checks=0;
for(const [i,f] of fixtures.entries()){const s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Pinned revert',currency:'USD',revision:0},accounts:f.accounts.map(id=>({id,ownerId:'one',name:id,type:'investment',currency:'USD',openingBalance:0,openingDate:'2026-01-01',archived:0})),securities:[{id:'security',ownerId:'one',ticker:'ABC',exchange:'XNYS',name:'Global',kind:'standard',websiteUrl:null}],trades:f.trades.map((t,j)=>({...t,ownerId:'one',securityId:'security',date:'2026-02-01',name:t.id,price:'1',fee:0,cashAmount:-Number(t.qty)*100,currency:'USD',activity:'buy',sequence:j,notes:'',importKey:null,conversion:null})),transactions:f.transactions.map(t=>({...t,ownerId:'one',date:'2026-02-01',name:t.id,amount:100,kind:'standard',categoryId:null,notes:'',transferId:null,importKey:null,excluded:0}))},p=planTradeCSVRevert(s,f.ownedTrades,f.ownedAccounts,'2026-03-01');checks++;assert.deepEqual(p.next.accounts.map(a=>a.id).sort(),actual[i].accounts);checks++;assert.deepEqual(p.next.trades.map(t=>t.id).sort(),actual[i].trades);checks++;assert.deepEqual(p.next.transactions.map(t=>t.id).sort(),actual[i].transactions);checks++;assert.equal(actual[i].status,'pending');checks++;assert.deepEqual(actual[i].trace,['begin','accounts','entries','commit','sync','status']);checks++;assert.deepEqual(p.next.securities,s.securities);}
console.log(`${checks} pinned Ruby Import#revert order/status and trade/account ownership-boundary checks passed (actual methods with association stubs; not full Rails SQL, dependent callbacks or background sync).`);
