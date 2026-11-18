import test from 'node:test';
import assert from 'node:assert/strict';
import {importRows,parseCSV} from '../lib/csv.ts';
import {csvAmount,csvDate} from '../lib/csv-formats.ts';
import {csvImportOptionsSchema,type CSVImportOptions} from '../lib/csv-schema.ts';
import {commandSchema} from '../lib/validation.ts';
const options=(patch:Partial<CSVImportOptions>={}):CSVImportOptions=>({delimiter:';',dateFormat:'dmy',numberFormat:'decimal-comma',amountMode:'signed',signage:'outflows-positive',columns:{date:0,name:1,amount:2},...patch});
for(const [format,input,expected] of [
 ['decimal-dot','1,234.56',123456],['decimal-dot','(1,234.56)',-123456],['decimal-dot','+0.29',29],['decimal-dot','-0.29',-29],
 ['decimal-comma','1.234,56',123456],['decimal-comma','(0,29)',-29],['space-comma','1 234,56',123456],['space-comma','1\u00a0234,56',123456],['space-comma','1\u202f234,56',123456],['integer-comma','1,234',123400],
] as const)test(`number format ${format} ${input}`,()=>assert.equal(csvAmount(input,'USD',format),expected));
for(const [format,inputs] of [
 ['decimal-dot',['1,23.45','12,34','1.234,56','1 234.56','$12','1e3','NaN','Infinity','--1','+-1','(-1)','(1','1)','1.',' .29','1.001','']],
 ['decimal-comma',['1,234.56','1.23,45','1 234,56','12,345','€12','1,']],
 ['space-comma',['1.234,56','12 34,56','1 23 456,78','1,234.56']],
 ['integer-comma',['1.00','1,23','1.234','1 234']],
] as const)for(const value of inputs)test(`reject ${format} ${JSON.stringify(value)}`,()=>assert.throws(()=>csvAmount(value,'USD',format)));
test('currency precision and supported minor-unit bound are exact',()=>{assert.equal(csvAmount('999,999,999,999','JPY','integer-comma'),999999999999);assert.equal(csvAmount('10,000,000,000.00','USD','decimal-dot'),1_000_000_000_000);assert.throws(()=>csvAmount('10,000,000,000.01','USD','decimal-dot'));assert.throws(()=>csvAmount('1,00','JPY','decimal-comma'));assert.equal(csvAmount('0.001','KWD','decimal-dot'),1);});
for(const [format,input,expected] of [['ymd','2024-02-29','2024-02-29'],['mdy','2/29/2024','2024-02-29'],['dmy','29/2/2024','2024-02-29'],['mdy','03/04/2026','2026-03-04'],['dmy','03/04/2026','2026-04-03']] as const)test(`explicit ${format} date ${input}`,()=>assert.equal(csvDate(input,format),expected));
for(const format of ['ymd','mdy','dmy'] as const)test(`dates reject impossible, short-year, alternate format ${format}`,()=>{for(const value of ['2026-02-30','02/29/2026','29/02/2026','1/1/26','2026-1-1','2026-03-01T00:00:00Z','01-02-2026','1899-01-01',''])assert.throws(()=>csvDate(value,format));});
for(const delimiter of [',',';','\t','|'] as const)test(`RFC quoting works with separator ${JSON.stringify(delimiter)}`,()=>{assert.deepEqual(parseCSV(`\uFEFFdate${delimiter}name${delimiter}amount\r\n2026-02-01${delimiter}"A${delimiter}B\n""C"""${delimiter}-0.29\r\n`,delimiter),[['date','name','amount'],['2026-02-01',`A${delimiter}B\n"C"`,'-0.29']]);assert.throws(()=>parseCSV('"unclosed',delimiter));});
test('mapped formats normalize to the identical legacy row including metadata',()=>{
 const legacy='date,name,amount,notes,category,merchant,tags,excluded,kind,currency,account,reconciled_status\n2026-02-01,Cafe,-1234.56,Note,Groceries,Market,"[""Trip""]",true,one_time,USD,Checking,cleared';
 const mapped='Posted;Description;Value;Memo;Group;Seller;Labels;Hide;Reporting;CCY;Ledger;Status\n01/02/2026;Cafe;1.234,56;Note;Groceries;Market;["Trip"];true;one_time;USD;Checking;cleared'.replace(';["Trip"];',';"[""Trip""]";');
 const config=options({columns:{date:0,name:1,amount:2,notes:3,category:4,merchant:5,tags:6,excluded:7,kind:8,currency:9,account:10,reconciled_status:11}});
 assert.deepEqual(importRows(mapped,'USD','Checking',config),importRows(legacy,'USD','Checking'));
});
test('unmapped data is ignored; names and formula-like text remain literal',()=>{const rows=importRows('When;Text;Cost;Ignore\n01/02/2026;=SUM(A1);0,29;invalid\n02/02/2026;+refund;-0,29;invalid','USD',undefined,options());assert.deepEqual(rows.map(r=>[r.name,r.amount]),[['=SUM(A1)',-29],['+refund',29]]);});
test('split debit and credit preserves direction independently of signed convention',()=>{for(const signage of ['outflows-positive','outflows-negative'] as const){const rows=importRows('Date;Description;Out;In\n01/02/2026;Purchase;1.234,56;\n02/02/2026;Pay;;2.000,00\n03/02/2026;Refund;0;0,29','USD',undefined,options({amountMode:'split',signage,columns:{date:0,name:1,debit:2,credit:3}}));assert.deepEqual(rows.map(row=>row.amount),[-123456,200000,29]);}});
for(const [debit,credit] of [['-1',''],['','-1'],['1','1'],['',''],['(1)','']])test(`reject split amounts ${debit}/${credit}`,()=>assert.throws(()=>importRows(`Date;Name;Out;In\n01/02/2026;Purchase;${debit};${credit}`,'USD',undefined,options({amountMode:'split',columns:{date:0,name:1,debit:2,credit:3}})),/Row 2/));
test('mapping rejects duplicate, absent, foreign and inactive columns',()=>{const base={...options(),columns:{date:0,name:1,amount:2}};for(const patch of [{columns:{date:0,name:0,amount:2}},{columns:{date:0,name:1}},{columns:{date:0,name:1,amount:2,debit:3}},{columns:{date:0,name:1,amount:2,unknown:3}},{amountMode:'split'},{dateFormat:'auto'},{delimiter:':'},{numberFormat:'guess'},{signage:'auto'},{extra:true},{columns:{date:-1,name:1,amount:2}},{columns:{date:0,name:1,amount:100}}])assert.equal(csvImportOptionsSchema.safeParse({...base,...patch}).success,false);assert.throws(()=>importRows('Date;Name\n01/02/2026;Purchase','USD',undefined,options()),/missing/);});
test('server command validates new options and retains old command compatibility',()=>{const accountId=crypto.randomUUID(),base={action:'import',accountId,csv:'data'};assert.ok(commandSchema.safeParse(base).success);assert.ok(commandSchema.safeParse({...base,csvOptions:options()}).success);assert.equal(commandSchema.safeParse({...base,csvOptions:{...options(),columns:{date:0,name:0,amount:2}}}).success,false);});
test('all legacy row validation remains after mapping, with original row number',()=>{
 const base='When;Description;Value;Extra\n01/02/2026;Valid;1,00;\n';
 for(const [field,value] of [['currency','JPY'],['account','Other'],['kind','funds_movement'],['category','x'.repeat(81)],['notes','x'.repeat(2001)],['tags','bad-json'],['excluded','maybe'],['merchant','x'.repeat(161)],['reconciled_status','verified']] as const){const config=options({columns:{date:0,name:1,amount:2,[field]:3}});assert.throws(()=>importRows(base+`02/02/2026;Invalid;2,00;${value}`,'USD','Checking',config),/Row 3/);}
 assert.throws(()=>importRows(base+'31/02/2026;Invalid;2,00;','USD',undefined,options()),/Row 3/);
 assert.throws(()=>importRows(base+'02/02/2026;Invalid;2,001;','USD',undefined,options()),/Row 3/);
 assert.throws(()=>importRows(base+'02/02/2026;Invalid;not-a-number;','USD',undefined,options()),/Row 3/);
 assert.throws(()=>importRows(base+'02/02/2026;Invalid;1,00','USD',undefined,options()),/Row 3/);
});
test('empty, duplicate and over-wide headers and row limits reject before writes',()=>{
 assert.throws(()=>importRows('','USD',undefined,options()),/empty/);
 assert.throws(()=>importRows('Date;date;Cost\n01/02/2026;Purchase;1','USD',undefined,options()),/unique/);
 assert.throws(()=>importRows(Array.from({length:101},(_,i)=>`col${i}`).join(';')+'\n'+Array(101).fill('a').join(';'),'USD',undefined,options()),/100 columns/);
 const csv='Date;Name;Cost\n'+Array(500).fill('01/02/2026;Coffee;0,29').join('\n');assert.equal(importRows(csv,'USD',undefined,options()).length,500);assert.throws(()=>importRows(csv+'\n01/02/2026;Coffee;0,29','USD',undefined,options()),/500/);
});
