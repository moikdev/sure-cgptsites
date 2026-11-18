import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {writeFileSync} from 'node:fs';import {xirrResult} from '../lib/xirr.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
let seed=709;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;},date=d=>new Date(Date.UTC(2020,0,d+1)).toISOString().slice(0,10),cases=[];
for(let i=0;i<1800;i++){const scale=[1e-12,1,1e9][i%3],flows=Array.from({length:2+random(8)},(_,j)=>({date:date(j*90+random(60)),amount:(random(200000)-100000)*scale}));cases.push({flows,unit:[1,7,30,365][i%4]});}
for(const unit of [1,7,30,365])for(const days of [1,30,100,365,1095,7600])for(const end of [Number.EPSILON,0.000001,0.5,0.9,1,2,5])cases.push({flows:[{date:date(0),amount:-1000},{date:date(days),amount:end*1000}],unit});
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal';require 'minitest'
class Date;def to_date;self;end;end
class String;def to_date;Date.iso8601(self);end;end
module Portfolio;end
load File.join(ARGV[0],'app/models/portfolio/xirr.rb')
$captured=[];$capture=true
module XirrCapture
 def new(flows,days_per_unit:365.0)
  if $capture && days_per_unit.finite? && days_per_unit>0
   rows=flows.map{|f|f.respond_to?(:date) ? {'date'=>f.date.to_date.iso8601,'amount'=>f.amount.to_f} : {'date'=>f[0].to_date.iso8601,'amount'=>f[1].to_f}}
   $captured<<{'flows'=>rows,'unit'=>days_per_unit} if rows.all?{|f|f['amount'].finite?}
  end
  super
 end
end
Portfolio::Xirr.singleton_class.prepend(XirrCapture)
# Only framework test declarations/assertion aliases and the source's one
# deliberately forced no-solver test are shimmed; numerical methods run unchanged.
module ActiveSupport
 class TestCase<Minitest::Test
  def self.test(name,&body);define_method('test_'+name.gsub(/\W/,'_'),&body);end
  def assert_not(*args);refute(*args);end
  def assert_not_nil(*args);refute_nil(*args);end
  def teardown
   ($xirr_stubs||{}).each{|method,original|Portfolio::Xirr.send(:define_method,method,original);Portfolio::Xirr.send(:private,method)};$xirr_stubs={}
  end
 end
end
class XirrStub
 def stubs(method);@method=method;self;end
 def returns(value);$xirr_stubs||={};$xirr_stubs[@method]||=Portfolio::Xirr.instance_method(@method);Portfolio::Xirr.send(:define_method,@method){value};self;end
end
Portfolio::Xirr.singleton_class.send(:define_method,:any_instance){XirrStub.new}
$LOADED_FEATURES << 'test_helper.rb'
load File.join(ARGV[0],'test/models/portfolio/xirr_test.rb')
success=Minitest.run(['--seed','709']);raise 'Pinned Ruby tests failed' unless success
$captured+=JSON.parse(STDIN.read);$capture=false
results=$captured.uniq.map do |c|
 x=Portfolio::Xirr.new(c['flows'].map{|f|[f['date'],f['amount']]},days_per_unit:c['unit']);begin;rate=x.rate.to_f;reason=nil;rescue Portfolio::Xirr::NoDurationError;reason='no_duration';rescue Portfolio::Xirr::NoSignChangeError;reason='no_sign_change';rescue Portfolio::Xirr::ConvergenceError;reason='convergence';end
 {'case'=>c,'rate'=>reason ? nil : rate,'reason'=>reason,'signChanges'=>x.sign_changes,'ambiguous'=>x.ambiguous?}
end
puts 'XIRR_RESULTS:'+JSON.generate(results)
`;
const output=execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:30e6});writeFileSync('outputs/xirr-pinned-ruby-tests.log',output.slice(0,output.indexOf('XIRR_RESULTS:')));const results=JSON.parse(output.split('XIRR_RESULTS:')[1]);
for(const [i,row] of results.entries()){const actual=xirrResult(row.case.flows,row.case.unit);assert.equal(actual.reason,row.reason,`case ${i} reason ${JSON.stringify(row.case)}`);assert.equal(actual.signChanges,row.signChanges,`case ${i} signs`);assert.equal(actual.ambiguous,row.ambiguous,`case ${i} ambiguity`);if(row.rate!==null)assert.ok(Math.abs(actual.rate-row.rate)<=Math.max(2e-8,Math.abs(row.rate)*2e-8),`case ${i} rate ${actual.rate} != ${row.rate}: ${JSON.stringify(row.case)}`);}
console.log(`PASS ${results.length} comparisons executing the actual pinned Portfolio::Xirr plus its full numerical test file with minimal framework/stub shims`);
