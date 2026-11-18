import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {planAutomaticTransfers} from '../lib/transfer-auto.ts';import {settingsState,settingsPending} from './fixtures/transfer-settings.ts';import {KINDS} from '../lib/finance.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference',cases=[];let seed=103;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let n=0;n<600;n++){const disabled=!!((random()>>>16)%2),enabled=!!((random()>>>16)%2),s=settingsState();s.profile.autoTransferDisabled=disabled?1:0;s.transactions=[];const pairs=[];for(let i=0;i<4;i++){const pending=(random()>>>16)%3!==0,outKind=pending?KINDS[(random()>>>16)%KINDS.length]:'funds_movement',inKind=pending?KINDS[(random()>>>16)%KINDS.length]:'funds_movement',p=settingsPending(outKind,inKind);for(const t of p.transactions)s.transactions.push({...t,id:t.id+'-'+i,importKey:t.id+'-'+i,transferId:'p-'+i});s.transferDetails.push({...p.transferDetails[0],id:'p-'+i,status:pending?'pending':'confirmed'});pairs.push({id:'p-'+i,pending,outKind,inKind});}const p=planAutomaticTransfers(s,{operation:'settings',enabled},'2026-03-01');cases.push({disabled,enabled,pairs,expected:{disabled:p.next.profile.autoTransferDisabled===1,removed:p.changes.map(c=>c.id).sort(),kept:p.next.transferDetails.map(d=>d.id).sort(),enqueued:disabled&&enabled,rejections:p.rejections.length}});}
assert.equal(new Set(cases.map(c=>JSON.stringify([c.disabled,c.enabled]))).size,4);assert.ok(cases.some(c=>c.expected.removed.length>0));assert.ok(cases.some(c=>c.expected.enqueued));
const ruby=String.raw`
require 'json'
class ApplicationController
 def self.layout(*args);end
 def self.before_action(*args,**kwargs);end
 attr_accessor :params
 def flash;@flash||={};end
 def respond_to;yield Format.new;end
 def auto_matches_path;'/auto_matches';end
 def redirect_to(*args,**kwargs);end
 def t(*args,**kwargs);'saved';end
end
class Format;def html;yield;end;end
class Current
 class << self;attr_accessor :family;end
end
class Family
 attr_reader :rows
 def initialize(disabled,rows);@disabled=disabled;@rows=rows;end
 def auto_match_transfers_disabled?;@disabled;end
 def update!(attrs);@disabled=attrs.fetch(:auto_match_transfers_disabled);end
 def self.transaction;yield;end
 def transactions;Transactions.new(rows.flat_map{|r|[r.id+'-out',r.id+'-in']});end
end
class Transactions
 def initialize(ids);@ids=ids;end
 def select(*args);@ids;end
end
class Row
 attr_reader :id,:pending,:out_kind,:in_kind
 attr_accessor :destroyed
 def initialize(c);@id=c['id'];@pending=c['pending'];@out_kind=c['outKind'];@in_kind=c['inKind'];@destroyed=false;end
 def destroy!;@destroyed=true;end
end
class Transfer
 def self.pending;Scope.new(Current.family.rows.select(&:pending));end
end
class Scope
 def initialize(rows);@rows=rows;end
 def where(**kwargs)
  rows=@rows.select do |r|
   kwargs.all? do |key,value|
    case key
    when :inflow_transaction_id then value.include?(r.id+'-in')
    when :outflow_transaction_id then value.include?(r.id+'-out')
    when :inflow_transaction then r.in_kind==value.fetch(:kind)
    when :outflow_transaction then r.out_kind==value.fetch(:kind)
    else raise 'Unexpected cleanup predicate'
    end
   end
  end
  Scope.new(rows)
 end
 def joins(*args);raise 'Unexpected cleanup joins' unless args==[:inflow_transaction,:outflow_transaction];self;end
 def find_each;@rows.each{|r|yield r};end
end
class AutoMatchTransfersJob
 class << self;attr_accessor :calls;end
 def self.perform_later(family);self.calls+=1;end
end
load File.join(ARGV[0],'app/controllers/auto_matches_controller.rb')
results=JSON.parse(STDIN.read).map do |c|
 rows=c['pairs'].map{|p|Row.new(p)};Current.family=Family.new(c['disabled'],rows);AutoMatchTransfersJob.calls=0
 controller=AutoMatchesController.new;controller.params={auto_match_transfers_disabled:c['enabled'] ? 'false' : 'true'};controller.update_settings
 {disabled:Current.family.auto_match_transfers_disabled?,removed:rows.select(&:destroyed).map(&:id).sort,kept:rows.reject(&:destroyed).map(&:id).sort,enqueued:AutoMatchTransfersJob.calls==1,rejections:0}
end
puts JSON.generate(results)
`;
const result=spawnSync('ruby',['-e',ruby,root],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:8_000_000});assert.equal(result.status,0,result.stderr);const rows=JSON.parse(result.stdout);assert.equal(rows.length,cases.length);for(let i=0;i<cases.length;i++)assert.deepEqual(rows[i],cases[i].expected,'Actual Ruby AutoMatchesController setting transition '+i);console.log(`Matched ${cases.length} actual Ruby AutoMatchesController#update_settings and cleanup cases, including standard-kind filtering, pending/confirmed retention, repeated settings and re-enable job requests. The port executes the re-enable scan within its reviewed atomic commit.`);
