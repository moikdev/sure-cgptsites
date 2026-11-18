import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {emptyState} from '../lib/finance.ts';import {planBulkDeletion} from '../lib/bulk-deletion.ts';
const root='/tmp/sure-upstream-port-reference',sha=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();assert.equal(sha,'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const source=readFileSync(root+'/app/models/transfer.rb','utf8'),start=source.indexOf('    def release_transactions'),end=source.indexOf('\n    end',start)+8,method=source.slice(start,end),transactionSource=readFileSync(root+'/app/models/transaction.rb','utf8'),kindsLine=transactionSource.split('\n').find(line=>line.includes('TRANSFER_KINDS =')),controller=readFileSync(root+'/app/controllers/transactions/bulk_deletions_controller.rb','utf8');assert.ok(controller.includes('where(parent_entry_id: nil)'));assert.ok(source.includes('has_many :fee_transactions, class_name: "Transaction", dependent: :destroy'));assert.ok(method.includes('transaction.unlock_attr!(:kind)'));
const kinds=['standard','one_time','funds_movement','cc_payment','loan_payment','investment_contribution'],cases=[];for(const outKind of kinds)for(const inKind of kinds)for(const pending of [false,true])for(const selected of [['out'],['in'],['out','in']]){const n=cases.length;cases.push({pending,selected,rows:[{id:'out',kind:outKind,lockedFields:n%2?['kind','name']:['name'],entryKey:'original-out'},{id:'in',kind:inKind,lockedFields:n%3?['kind','name']:['name'],entryKey:'original-in'}]});}
const ruby=String.raw`
require 'json'
class String;def present?;!empty?;end;end
class NilClass;def present?;false;end;end
class Transaction
 CONSTANTS
 def self.exists?(id);$rows.any?{|r|r['id']==id};end
 def initialize(row);@row=row;end
 def id;@row['id'];end
 def kind;@row['kind'];end
 def transfer?;TRANSFER_KINDS.include?(kind);end
 def locked?(key);@row['lockedFields'].include?(key.to_s);end
 def unlock_attr!(key);@row['lockedFields'].delete(key.to_s);end
 def update!(**attrs);attrs.each{|k,v|@row[k.to_s]=v};end
 def entry;self;end
 def idempotency_key;@row['entryKey'];end
end
class Transfer
 def initialize(c);@c=c;end
 def inflow_transaction;Transaction.new($rows.find{|r|r['id']=='in'});end
 def outflow_transaction;Transaction.new($rows.find{|r|r['id']=='out'});end
 def pending?;@c['pending'];end
 def destroyed_by_association;Struct.new(:foreign_key).new(@c['selected'].first=='out' ? 'outflow_transaction_id' : 'inflow_transaction_id');end
 METHOD
 def execute;release_transactions;end
end
input=JSON.parse(STDIN.read)
puts JSON.generate(input.map{|c|$rows=c['rows'];Transfer.new(c).execute;$rows.reject{|r|c['selected'].include?(r['id'])}})
`.replace('CONSTANTS',kindsLine.trim()).replace('METHOD',method);
// Entry#update! accepts idempotency_key; map that mock field to its saved entry key.
const adaptedRuby=ruby.replace("@row[k.to_s]=v","@row[k.to_s=='idempotency_key' ? 'entryKey' : k.to_s]=v"),results=JSON.parse(execFileSync('ruby',['-e',adaptedRuby],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8*1024*1024}));let released=0;
for(let i=0;i<cases.length;i++){const c=cases[i],ownerId='one',accounts=['a','b'].map(id=>({id,ownerId,name:id,type:'checking',currency:'USD',openingBalance:100000,openingDate:'2020-01-01',archived:0})),transactions=c.rows.map((r,j)=>({id:r.id,ownerId,accountId:j?'b':'a',categoryId:null,merchantId:null,tagIds:[],date:'2026-01-02',name:r.id,amount:j?1000:-1000,kind:r.kind,transferId:'pair',notes:'Keep notes',importKey:null,lockedFields:r.lockedFields,reconciledStatus:'cleared',reconciledAt:null,reconciledStatementId:null})),fee={...transactions[0],id:'fee',amount:-10,kind:'standard',transferId:null,lockedFields:[]},state={...structuredClone(emptyState),profile:{ownerId,name:'Source comparison',currency:'USD',revision:0},accounts,transactions:c.pending?transactions:[...transactions,fee],transferDetails:[{id:'pair',ownerId,date:'2026-01-02',destinationDate:'2026-01-02',fromCurrency:'USD',toCurrency:'USD',fromAmount:1000,toAmount:1000,rateNumerator:'1',rateDenominator:'1',rateDate:null,rateSource:'identity',sourceFee:c.pending?0:10,destinationFee:0,requestId:null,requestFingerprint:null,status:c.pending?'pending':'confirmed'}],transferFees:c.pending?[]:[{id:'fee-link',ownerId,transferId:'pair',transactionId:'fee',side:'source'}]},p=planBulkDeletion(state,c.selected);assert.deepEqual(p.next.transactions.map(t=>({id:t.id,kind:t.kind,lockedFields:t.lockedFields})),results[i].map(r=>({id:r.id,kind:r.kind,lockedFields:r.lockedFields})));assert.ok(results[i].every(r=>r.entryKey===null));assert.ok(p.next.transactions.every(t=>t.transferId===null&&t.reconciledStatus==='cleared'));assert.equal(p.next.transferFees.length,0);assert.equal(p.next.transferDetails.length,0);released+=p.released.length;}
const result={upstreamCommit:sha,cases:cases.length,survivingLegs:released,methodSHA256:createHash('sha256').update(method).digest('hex'),actualMethod:'Transfer#release_transactions',scope:'Controlled transaction/entry/existence/association adapters; controller split-root scope and dependent fee cascade inspected, not full Rails callbacks, persistence or materialization.'};writeFileSync('outputs/bulk-deletion-differential.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
