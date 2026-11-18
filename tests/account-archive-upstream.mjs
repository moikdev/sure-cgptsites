import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {archiveParticipation,sourceArchiveDate} from '../lib/account-archive.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const cases=[];for(let i=0;i<240;i++){const month=String(i%12+1).padStart(2,'0'),day=String(i%27+1).padStart(2,'0'),date=`2024-${month}-${day}`,disabled=i%3!==0;cases.push({id:String(i),status:disabled?'disabled':'active',disabled_at:i%4===0?null:date+'T23:30:00'+(i%2?'-02:00':'+09:00'),updated_at:date+'T12:00:00Z'});}
const ruby=String.raw`
require 'json';require 'date';require 'time'
class Integer;def day;self;end;end
class String;def squish;split.join(' ');end;end
class BalanceSheet;end;class Balance;end
load File.join(ARGV[0],'app/models/balance_sheet/net_worth_series_builder.rb')
load File.join(ARGV[0],'app/models/balance_sheet/net_worth_breakdown_series_builder.rb')
load File.join(ARGV[0],'app/models/balance/chart_series_builder.rb')
Account=Struct.new(:id,:status,:disabled_at,:updated_at){def disabled?;status=='disabled';end}
# Active Record's default UTC storage round trip is represented explicitly.
accounts=JSON.parse(STDIN.read).map{|a|Account.new(a['id'],a['status'],a['disabled_at'] && Time.iso8601(a['disabled_at']).utc,Time.iso8601(a['updated_at']).utc)}
a=BalanceSheet::NetWorthSeriesBuilder.new(nil);a.instance_variable_set(:@historical_accounts,accounts)
b=BalanceSheet::NetWorthBreakdownSeriesBuilder.new(nil)
plain=a.send(:disabled_account_active_until_dates);breakdown=b.send(:disabled_account_active_until_dates,accounts)
chart=Balance::ChartSeriesBuilder.new(account_ids:accounts.map(&:id),currency:'USD',period:nil,account_active_until_dates:plain)
puts JSON.generate({plain:plain.transform_values(&:iso8601),breakdown:breakdown.transform_values(&:iso8601),chart:chart.send(:account_active_until_dates),query:chart.send(:query),gains_query:chart.send(:gains_query)})
`;
const source=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify(cases),encoding:'utf8',maxBuffer:1e6}));assert.deepEqual(source.plain,source.breakdown);assert.deepEqual(source.chart,source.plain);
for(const query of [source.query,source.gains_query])assert.match(query,/ON accounts\.active_until_date IS NULL OR d\.date <= accounts\.active_until_date/);
let dates=0;for(const c of cases){const archive=sourceArchiveDate(c);if(c.status==='active'){assert.equal(source.plain[c.id],undefined);assert.equal(archive.archivedOn,undefined);continue;}assert.ok(archive.archivedOn);const end=new Date(archive.archivedOn+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-1);assert.equal(source.plain[c.id],end.toISOString().slice(0,10));for(const delta of [-1,0,1]){const at=new Date(archive.archivedOn+'T00:00:00Z');at.setUTCDate(at.getUTCDate()+delta);const date=at.toISOString().slice(0,10),included=date<=source.plain[c.id];assert.equal(archiveParticipation({archived:1,archivedOn:archive.archivedOn,openingDate:'1900-01-01'},date,'historical')==='before_cutoff',included);dates++;}}
console.log(`PASS ${cases.length} accounts and ${dates} boundary dates executing actual pinned net-worth/breakdown cutoff methods and ChartSeriesBuilder cutoff serialization; verified both source SQL join predicates, UTC storage simulated, no Rails relations/PostgreSQL query execution. Unknown-date behavior is an explicit port adaptation.`);
