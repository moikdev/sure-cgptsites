import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState} from '../lib/finance.ts';import {planCSVImportRevert} from '../lib/csv-import-revert.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const cases=[];for(const pending of [false,true])for(const kind of ['standard','one_time','funds_movement','cc_payment','loan_payment','investment_contribution'])for(const locks of [[],['name'],['kind'],['name','kind']]){const a={id:'a',ownerId:'one',name:'A',type:'checking',currency:'USD',openingBalance:10000,openingDate:'2026-01-01',archived:0},b={...a,id:'b',name:'B'},tx={ownerId:'one',date:'2026-02-01',categoryId:null,notes:'',importKey:'keep-import-key',transferId:'t',name:'Entry'},s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Source comparison',currency:'USD',revision:1},accounts:[a,b],transactions:[{...tx,id:'out',accountId:'a',amount:-100,kind:'standard'},{...tx,id:'in',accountId:'b',amount:100,kind,lockedFields:locks}],transferDetails:[{id:'t',ownerId:'one',date:'2026-02-01',destinationDate:'2026-02-01',fromCurrency:'USD',toCurrency:'USD',fromAmount:100,toAmount:100,rateNumerator:'1',rateDenominator:'1',rateDate:null,rateSource:'identity',sourceFee:0,destinationFee:0,requestId:null,requestFingerprint:null,status:pending?'pending':'confirmed'}]},p=planCSVImportRevert(s,['out']),kept=p.next.transactions[0];assert.equal(kept.importKey,'keep-import-key');assert.equal(p.next.transferDetails.length,0);cases.push({pending,kind,locks,expected:{kind:kept.kind,locks:kept.lockedFields}});}
const ruby=String.raw`
require 'json'
class NilClass;def present?;false;end;end
class String;def present?;!empty?;end;end
class Transaction
 TRANSFER_KINDS=%w[funds_movement cc_payment loan_payment investment_contribution]
 def self.exists?(_id);true;end
end
class SourceEntry
 attr_accessor :idempotency_key
 def initialize;@idempotency_key='original-request-key';end
 def update!(attrs);@idempotency_key=attrs.fetch(:idempotency_key);end
end
class SourceTransaction
 attr_reader :id,:kind,:locks,:entry
 def initialize(id,kind,locks);@id=id;@kind=kind;@locks=locks.dup;@entry=SourceEntry.new;end
 def transfer?;Transaction::TRANSFER_KINDS.include?(kind);end
 def locked?(field);locks.include?(field.to_s);end
 def unlock_attr!(field);locks.delete(field.to_s);end
 def update!(attrs);@kind=attrs.fetch(:kind);end
end
class SourceTransfer
 attr_accessor :inflow_transaction,:outflow_transaction,:destroyed_by_association,:pending
 def pending?;pending;end
end
body=File.read(File.join(ARGV[0],'app/models/transfer.rb'))[/    def release_transactions\n.*?(?=    def transfer_has_different_accounts)/m]
raise 'Pinned release method missing' unless body
# Execute the actual source method; only ActiveRecord persistence boundaries,
# the deleted association and ActiveSupport presence are fixture objects.
SourceTransfer.class_eval(body)
result=JSON.parse(STDIN.read).map do |row|
 x=SourceTransfer.new;x.pending=row['pending'];x.destroyed_by_association=Struct.new(:foreign_key).new('outflow_transaction_id');x.outflow_transaction=SourceTransaction.new('out','standard',[]);x.inflow_transaction=SourceTransaction.new('in',row['kind'],row['locks']);x.send(:release_transactions)
 raise 'Surviving request key was not cleared' unless x.inflow_transaction.entry.idempotency_key.nil?
 {kind:x.inflow_transaction.kind,locks:x.inflow_transaction.locks}
end
puts JSON.generate(result)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8'}));assert.deepEqual(actual,cases.map(c=>c.expected));console.log(`${cases.length} pinned Ruby surviving-transfer release cases matched`);
