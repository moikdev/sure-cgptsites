import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {qifCatalog,planQIFImport,qifTradeQuantityLabel,qifCashName} from '../lib/qif-plan.ts';
import {emptyState,moneyInput,parseMoney} from '../lib/finance.ts';
import {canonicalDecimal,QTY_SCALE} from '../lib/decimal.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
assert.match(readFileSync(root+'/Gemfile.lock','utf8'),/activesupport \(8\.1\.4\.1\)/);
// Actual framework formatting, vendored for offline parity with its MIT notice.
// https://github.com/rails/rails/blob/v8.1.4.1/activesupport/lib/active_support/core_ext/big_decimal/conversions.rb
assert.equal(createHash('sha256').update(readFileSync('tests/fixtures/rails-8.1.4.1-bigdecimal-conversions.rb')).digest('hex'),'3bc11ad92cdd4bfb5cb8e89b58fb17fb44e9ea5f590d2e841d86cdab1a23b8f3');
const trades=[];for(const action of ['Buy','ReinvDiv','Cover','Sell','ShtSell'])for(const qty of ['0','1','-1','0.001','-0.001','1.234567890123456789'])for(const price of ['0','10'])for(const amount of ['0','1','20','-20','21'])trades.push({action,qty,price,amount});
const cash=[];for(const action of ['Div','IntInc','XIn','XOut','CGLong','CGShort','MiscInc','MiscExp','Unknown'])for(const security_name of [null,'ACME'])for(const payee of [null,'Payee'])for(const memo of [null,'Memo'])cash.push({action,security_name,payee,memo,amount:'3'});
const splits=[];for(const signage of ['inflows_positive','inflows_negative'])for(const amount of ['0','-10','10'])for(const child of [['0','0'],['-12','2'],['-12','1'],['12','-2']])splits.push({signage,amount,child});
const openings=[];for(const earliest of [null,'2020-01-01','2026-11-16','2026-11-17'])for(const date of ['2019-12-31','2020-01-01','2026-11-16','2026-11-17'])openings.push({earliest,date});
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal/util';require 'ostruct'
load File.join(ARGV[1],'tests/fixtures/rails-8.1.4.1-bigdecimal-conversions.rb')
class Object;def blank?;respond_to?(:empty?) ? empty? : !self;end;def present?;!blank?;end;def presence;self if present?;end;end
class String;def blank?;strip.empty?;end;end
class Import;def self.after_create(*);end;attr_accessor :signage_convention;end
load File.join(ARGV[0],'app/models/concerns/qif_parser.rb')
load File.join(ARGV[0],'app/models/qif_import.rb')
class Trade;class << self;end;end
src=File.read(File.join(ARGV[0],'app/models/trade.rb'));method=src[/^    def build_name\(.*?^    end/m];raise 'actual Trade.build_name missing' unless method;Trade.singleton_class.class_eval(method)
class Entry
 attr_reader :amount,:children
 def initialize(amount);@amount=amount.to_d;end
 def name;'Parent';end
 def split!(rows);@children=rows.map{|r|Child.new(r)};end
end
class Child
 attr_reader :row
 def initialize(row);@row=row;end
 def update!(notes:);@row[:notes]=notes;end
 def entryable;self;end
 def taggings;self;end
 def create!(tag:);end
end
class Account;end
load File.join(ARGV[0],'app/models/account/opening_balance_manager.rb')
class Date;def to_date;self;end;end
class Integer;def day;self;end;def years;OpenStruct.new(ago:Date.new(2026,11,16) << (12*self));end;end
p=JSON.parse(STDIN.read);q=QifImport.new
mapping=Object.new;def mapping.mappable_for(label);label.present? ? OpenStruct.new(id:label) : nil;end
maps=OpenStruct.new(categories:mapping,tags:mapping);q.define_singleton_method(:mappings){maps}
result={trades:p['trades'].map{|t|r=OpenStruct.new(t.merge('security_ticker'=>'ACME','security_name'=>'ACME'));{qty:q.send(:trade_qty_for,t['action'],t['qty']).to_s('F'),name:q.send(:trade_row_name,r),label:q.send(:investment_activity_label_for,t['action']),entry:(QifParser::BUY_LIKE_ACTIONS.include?(t['action']) ? t['amount'].to_d : -t['amount'].to_d).to_s('F')}},cash:p['cash'].map{|t|r=OpenStruct.new(t);{name:q.send(:transaction_row_name,r),entry:(QifParser::INFLOW_TRANSACTION_ACTIONS.include?(t['action']) ? -t['amount'].to_d : t['amount'].to_d).to_s('F')}},types:%w[Bank Cash CCard Invst].concat(['Oth A','Oth L','Unknown']).map{|t|q.send(:accountable_type_for_qif_type,t)},splits:p['splits'].map{|s|q.signage_convention=s['signage'];entry=Entry.new(q.send(:signed_transaction_amount,s['amount']));parsed=OpenStruct.new(split_lines:s['child'].each_with_index.map{|a,i|OpenStruct.new(amount:a,category:'Category'+i.to_s,memo:(i==0 ? 'Memo' : nil),tags:(i==0 ? ['Child'] : []))});q.send(:import_split_lines!,entry,parsed,fallback_tags:['Parent']);{parent:entry.amount.to_s('F'),children:entry.children&.map{|c|c.row.merge(amount:c.row[:amount].to_s('F'),tags:c.row[:tags].map{|t|t.respond_to?(:id) ? t.id : t})}}},openings:p['openings'].map{|o|m=Account::OpeningBalanceManager.new(nil);earliest=o['earliest']&&Date.parse(o['earliest']);m.define_singleton_method(:oldest_entry_date){earliest};{error:m.date_error(Date.parse(o['date'])),default:m.default_date.to_s}}}
puts JSON.generate(result)
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root,process.cwd()],{input:JSON.stringify({trades,cash,splits,openings}),encoding:'utf8',maxBuffer:8_000_000}));let checks=0;
const check=(a,b,label)=>{checks++;assert.deepEqual(a,b,label);},state=()=>({...structuredClone(emptyState),profile:{ownerId:'qif-source-test',name:'QIF',currency:'USD',revision:0}}),date='2026-11-16';
for(const [i,t] of trades.entries()){const s=state(),text=`!Type:Invst\nD01/02/2026\nN${t.action}\nYACME\nQ${t.qty}\nI${t.price}\nT${t.amount}\n^\n`,cfg=qifCatalog(text,s,'mdy',date).suggestions,p=await planQIFImport(s,text,cfg,'ruby-'+i,date),row=p.data.trades[0],r=actual.trades[i];check(row.qty,canonicalDecimal(r.qty,QTY_SCALE),'actual trade qty '+i);check(row.cashAmount,-parseMoney(r.entry.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''),'USD')||0,'actual trade cash '+i);check(row.name,r.name,'actual Trade.build_name '+i);check(qifTradeQuantityLabel(t.qty.replace(/^-/,'')),r.name.split(' ')[1],'actual Rails BigDecimal name '+i);}
for(const [i,t] of cash.entries()){const r=actual.cash[i];check(qifCashName({...t,securityName:t.security_name}),r.name,'actual cash action name '+i);const s=state(),text=`!Type:Invst\nD01/02/2026\nN${t.action}\nT3\n${t.security_name?'Y'+t.security_name+'\n':''}${t.payee?'P'+t.payee+'\n':''}${t.memo?'M'+t.memo+'\n':''}^\n`,p=await planQIFImport(s,text,qifCatalog(text,s,'mdy',date).suggestions,'cash-'+i,date);check(moneyInput(p.data.transactions[0].amount,'USD'),moneyInput(-parseMoney(r.entry.replace(/\.0$/,''),'USD'),'USD'),'actual cash action entry '+i);}
for(const [i,c] of splits.entries()){const s=state(),text=`!Type:Bank\nD01/02/2026\nT${c.amount}\nPParent\nLParent/Parent\nSCategory0/Child\n$${c.child[0]}\nEMemo\nSCategory1\n$${c.child[1]}\n^\n`,cfg={...qifCatalog(text,s,'mdy',date).suggestions,signage:c.signage==='inflows_positive'?'inflows-positive':'outflows-positive'},p=await planQIFImport(s,text,cfg,'split-'+i,date),r=actual.splits[i];check(moneyInput(p.data.transactions[0].amount,'USD'),moneyInput(-parseMoney(r.parent.replace(/\.0$/,''),'USD'),'USD'),'actual signed split parent '+i);check(p.data.splitLines.length,r.children?.length??0,'actual mismatched split behavior '+i);if(r.children)for(const [j,line] of p.data.splitLines.entries()){check(moneyInput(line.amount,'USD'),moneyInput(-parseMoney(r.children[j].amount.replace(/\.0$/,''),'USD'),'USD'),'actual split child amount '+i);check(line.name,r.children[j].name,'actual split child name '+i);check(line.tagIds.map(id=>p.data.tags.find(t=>t.id===id).name),r.children[j].tags,'actual split child tags '+i);}}
for(const [i,o] of openings.entries()){const r=actual.openings[i],valid=!o.earliest||o.date<o.earliest;check(r.error===null,valid,'actual OpeningBalanceManager strict date '+i);check(r.default,o.earliest&&o.earliest<'2024-11-17'?new Date(Date.parse(o.earliest)-86400000).toISOString().slice(0,10):'2024-11-16','actual OpeningBalanceManager default '+i);}
check(actual.types,['Depository','Depository','CreditCard','Investment','OtherAsset','OtherLiability','Depository'],'actual account type mapping');
console.log(`${checks} comparisons execute pinned QifImport mapping/sign/split/name methods, Trade.build_name and OpeningBalanceManager date/default methods with the pinned Rails BigDecimal conversion (persistence/relations stubbed; not full Rails SQL).`);
