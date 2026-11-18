import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {emptyState,accountBalance} from '../lib/finance.ts';import {assetPurchaseBasis,planVehiclePurchase,propertySquareFeet} from '../lib/manual-asset.ts';
const reference=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',reference,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');const day='2026-10-16',cases=[],states=[];
for(let i=0;i<300;i++){const currency=['USD','JPY','KWD'][i%3],s={...structuredClone(emptyState),profile:{ownerId:'one',name:'Source',currency,revision:0},accounts:[{id:'asset',ownerId:'one',name:'Vehicle',type:'vehicle',currency,openingBalance:(i*271)%100000-10000,openingDate:'2019-01-01',archived:0}]},mode=i%6,amount=(i*431)%200000-5000,anchorDate=mode===0?day:'2020-01-01';if(mode!==5)s.valuations.push({id:'anchor',ownerId:'one',accountId:'asset',date:anchorDate,amount:s.accounts[0].openingBalance,name:'Opening',kind:'opening_anchor'});if(mode===1||mode===5)s.valuations.push({id:'later',ownerId:'one',accountId:'asset',date:'2025-01-01',amount:30000,name:'Later',kind:'history'});if(mode===2)s.valuations.push({id:'older',ownerId:'one',accountId:'asset',date:'2019-06-01',amount:50000,name:'Older',kind:'history'});if(mode===3)s.valuations.push({id:'future',ownerId:'one',accountId:'asset',date:'2027-01-01',amount:50000,name:'Future',kind:'history'});const previous=assetPurchaseBasis(s,s.accounts[0]),date=mode===4?'2019-12-31':previous.date,p=planVehiclePurchase(s,'asset',amount,date,day);states.push(s);cases.push({currency,precision:{USD:2,JPY:0,KWD:3}[currency],opening:s.accounts[0].openingBalance,openingDate:s.accounts[0].openingDate,amount,date,day,current:accountBalance(s.accounts[0],s,day),previous,values:s.valuations.map(v=>({id:v.id,date:v.date,amount:v.amount,kind:v.kind})),plan:p});}
const areas=Array.from({length:1000},(_,i)=>({value:i%10===0?0:i%13===0?2147483647:i*37+1,unit:i%2?'sqft':'sqm'}));
const ruby=String.raw`
require 'json';require 'date';require 'bigdecimal'
module Accountable;end
module ActiveModel;module Validations;def self.included(base);base.extend(ClassMethods);end;module ClassMethods;def validates(*);end;end;def validate!;true;end;end;end
class Object;def blank?;nil?;end;def present?;!nil?;end;end
class Date;def self.current;$day;end;end
class Ago;def initialize(n);@n=n;end;def ago;self;end;def to_date;Date.current << (12*@n);end;end
class Integer;def day;self;end;def years;Ago.new(self);end;end
class ApplicationRecord
 def self.attribute(name,*);attr_accessor name;end
 def self.validate(*);end;def self.after_update(*);end;def self.has_one(*);end;def self.accepts_nested_attributes_for(*);end
end
class Money
 include Comparable
 class Currency
  attr_reader :default_precision
  def initialize(code);@default_precision={'USD'=>2,'JPY'=>0,'KWD'=>3}.fetch(code);end
 end
 attr_reader :amount,:currency
 def initialize(amount,currency);@amount=BigDecimal(amount.to_s);@currency=currency;end
 def <=>(v);amount <=> v.amount;end
 def -(v);Money.new(amount-v.amount,currency);end
 def zero?;amount.zero?;end;def negative?;amount.negative?;end;def to_f;amount.to_f;end
end
class Account;end
load File.join(ARGV[0],'app/models/account/opening_balance_manager.rb')
load File.join(ARGV[0],'app/models/measurement.rb');load File.join(ARGV[0],'app/models/vehicle.rb');load File.join(ARGV[0],'app/models/property.rb')
class Vehicle;attr_accessor :account,:mileage_value,:mileage_unit;end
class Property;attr_accessor :account,:area_value,:area_unit;end
Row=Struct.new(:id,:date,:amount,:kind,:currency){def amount_money;Money.new(amount,currency);end}
class Entries
 def initialize(rows);@rows=rows;end
 def valuations;self;end
 def order(*);Entries.new(@rows.sort_by(&:date));end
 def first;@rows.first;end
 def where(date:);Entries.new(@rows.select{|r|date.cover?(r.date)});end
 def exists?;!@rows.empty?;end
end
class FakeAccount
 attr_reader :rows,:currency,:balance,:pin
 def initialize(c)
  @currency=c['currency'];@scale=10**c['precision'];@rows=c['values'].map{|r|Row.new(r['id'],Date.parse(r['date']),BigDecimal(r['amount'].to_s)/@scale,r['kind'],@currency)};@balance=BigDecimal(c['current'].to_s)/@scale
 end
 def entries;Entries.new(rows);end
 def anchor;rows.find{|r|r.kind=='opening_anchor'};end
 def has_opening_anchor?;!anchor.nil?;end
 def opening_anchor_balance;anchor&.amount || BigDecimal('0');end
 def opening_anchor_date;anchor&.date || rows.map(&:date).min || Date.current;end
 def balance_money;Money.new(balance,currency);end
 def set_opening_anchor_balance(balance:,date:nil)
  manager=Account::OpeningBalanceManager.new(self);manager.define_singleton_method(:oldest_entry_date){@account.rows.reject{|r|r.id==@account.anchor&.id}.map(&:date).min};date ||= anchor&.date || manager.default_date;error=manager.date_error(date) if date!=anchor&.date;raise error if error
  if anchor;anchor.amount=balance;anchor.date=date;else;rows << Row.new('created',date,balance,'opening_anchor',currency);end
  Struct.new(:success?,:error).new(true,nil)
 end
 def record_pin(balance,date);@pin={date:date.to_s,amount:balance};rows << Row.new('pin',date,balance,'reconciliation',currency);end
end
class Account::ReconciliationManager
 def initialize(account);@account=account;end
 def reconcile_balance(balance:,date:);@account.record_pin(balance,date);Struct.new(:success?,:error_message).new(true,nil);end
end
input=JSON.parse(STDIN.read);values=input['cases'].map do |c|
 $day=Date.parse(c['day']);scale=10**c['precision'];a=FakeAccount.new(c);vehicle=Vehicle.new;vehicle.account=a;before=(vehicle.purchase_price.amount*scale).to_i;vehicle.initial_balance=BigDecimal(c['amount'].to_s)/scale;vehicle.initial_balance_shown=vehicle.purchase_price.amount;vehicle.purchase_date=Date.parse(c['date']);vehicle.send(:update_purchase_anchor)
 {before:before,date:a.anchor.date.to_s,amount:(a.anchor.amount*scale).to_i,pin:a.pin ? {date:a.pin[:date],amount:(a.pin[:amount]*scale).to_i} : nil}
end
areas=input['areas'].map{|c|p=Property.new;p.area_value=c['value'];p.area_unit=c['unit'];p.area_in_sqft}
# Actual opening-manager date boundary. Model/relations are controlled adapters.
boundaries=[];account=FakeAccount.new({'currency'=>'USD','precision'=>2,'values'=>[{'id'=>'other','date'=>'2020-01-02','amount'=>100,'kind'=>'history'}],'current'=>100});m=Account::OpeningBalanceManager.new(account);def m.oldest_entry_date;Date.new(2020,1,2);end
['2020-01-01','2020-01-02','2020-01-03'].each{|d|boundaries << m.date_error(Date.parse(d))}
puts JSON.generate({values:values,areas:areas,boundaries:boundaries})
`;
const source=JSON.parse(execFileSync('ruby',['-e',ruby,reference],{input:JSON.stringify({cases,areas}),encoding:'utf8',maxBuffer:5e6}));for(let i=0;i<cases.length;i++){const c=cases[i],o=source.values[i],p=c.plan;assert.equal(c.previous.amount,o.before,`purchase precedence ${i}`);assert.equal(p.date,o.date,`anchor date ${i}`);assert.equal(p.amount,o.amount,`anchor amount ${i}`);assert.deepEqual(p.pin&&{date:p.pin.date,amount:p.pin.amount},o.pin,`pin ${i}`);}
for(let i=0;i<areas.length;i++)assert.equal(propertySquareFeet(areas[i].value,areas[i].unit),source.areas[i]);assert.equal(source.boundaries[0],null);assert.ok(source.boundaries[1]);assert.ok(source.boundaries[2]);console.log(`PASS ${cases.length} actual pinned Vehicle purchase precedence/update/keep-current paths across USD/JPY/KWD, ${areas.length} Property#area_in_sqft conversions and strict OpeningBalanceManager boundaries. Controlled Money/account/relation adapters, not Rails SQL/transactions/asynchronous sync; normalized opening fallback and multiple-anchor handling are independent port adaptations.`);
