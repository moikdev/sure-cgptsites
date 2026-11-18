import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {classifyPortfolioFlow,FLOW_LABELS} from '../lib/portfolio-flows.ts';
const cases=[];
for(const type of ['trade','transaction','valuation'])for(const label of [null,...FLOW_LABELS])for(const kind of ['standard','one_time','funds_movement','loan_payment'])for(const direction of [-1,0,1])for(const excluded of [false,true])for(const pending of [false,true])for(const inside of [false,true]){
 const input={type,label,kind,qty:String(direction),cashAmount:direction*123,accountId:'a',excluded,pending,feeLeg:cases.length%3===0,counterpartAccountId:inside?'b':'outside',securityCounterpartAccountIds:inside?['a','b']:['a','outside']},scope=inside?['a','b']:['a'];cases.push({input,scope,expected:classifyPortfolioFlow(input,new Set(scope)).classification});
}
const ruby=String.raw`
require 'json'
class Object;def present?;true;end;end
class NilClass;def present?;false;end;end
class Portfolio;end
class Trade
 attr_reader :qty,:investment_activity_label
 def initialize(qty,label);@qty=qty.to_i;@investment_activity_label=label;end
end
class Transaction
 TRANSFER_KINDS=%w[funds_movement cc_payment loan_payment investment_contribution].freeze
 attr_reader :investment_activity_label,:kind,:transfer_id
 def initialize(input);@investment_activity_label=input['label'];@kind=input['kind'];@pending=input['pending'];@transfer_id=input['feeLeg'] ? 'fee-link' : nil;end
 def pending?;@pending;end
 def transfer?;TRANSFER_KINDS.include?(kind);end
end
EntryFixture=Struct.new(:entryable,:amount,:account_id,:excluded) do
 def excluded?;excluded;end
end
load File.join(ARGV[0],'app/models/portfolio/flow_classifier.rb')
# Replace only the two ActiveRecord lookup boundaries. The pinned classifier's
# constants, public classify and complete trade/transaction decision tree run.
class FixtureClassifier < Portfolio::FlowClassifier
 attr_accessor :counterpart,:security_accounts
 private
 def transfer_counterpart_account_id(_transaction);counterpart;end
 def security_transfer_counterpart_in_scope?(entry,_trade);security_accounts.any?{|id|id!=entry.account_id&&scope_account_ids.include?(id)};end
end
results=JSON.parse(STDIN.read).map do |row|
 input=row.fetch('input');classifier=FixtureClassifier.new(scope_account_ids:row.fetch('scope'));classifier.counterpart=input['counterpartAccountId'];classifier.security_accounts=input['securityCounterpartAccountIds'];value=case input['type'];when 'trade' then Trade.new(input['qty'],input['label']);when 'transaction' then Transaction.new(input);else Object.new;end
 classifier.classify(EntryFixture.new(value,-input['cashAmount'],input['accountId'],input['excluded']))
end
puts JSON.generate(results)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,process.argv[2]??'/tmp/sure-upstream-port-reference'],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8_000_000}));assert.deepEqual(actual,cases.map(row=>row.expected));console.log(`${cases.length} pinned Ruby portfolio flow classification cases matched`);
