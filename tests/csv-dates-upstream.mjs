import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {CSV_DATE_FORMATS} from '../lib/csv-date-formats.ts';import {csvDate} from '../lib/csv-formats.ts';import {dateSamples,dateEdges} from './csv-dates-fixtures.ts';
const root=process.argv[2]??'/tmp/sure-upstream-port-reference';assert.equal(execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'d194118a3b80cd3f88d111e73ff5f6255c42c22b');
const fixtures=[...CSV_DATE_FORMATS.map(f=>({format:f.ruby,value:dateSamples[f.value],expected:csvDate(dateSamples[f.value],f.value)})),...dateEdges.map(([format,value,expected])=>({format:CSV_DATE_FORMATS.find(f=>f.value===format).ruby,value,expected}))];
const ruby=String.raw`
require 'json';require 'date'
family=File.read(File.join(ARGV[0],'app/models/family.rb'));source=File.read(File.join(ARGV[0],'app/models/import.rb'));row=File.read(File.join(ARGV[0],'app/models/import/row.rb'))
formats=eval(family[/  DATE_FORMATS = (\[.*?\n  \])\.freeze/m,1])+eval(source[/  CSV_ONLY_DATE_FORMATS = (\[.*?\n  \])\.freeze/m,1])
klass=Class.new do
 attr_accessor :date,:import
end
klass.class_eval(row[/  def date_iso\n.*?\n  end/m])
results=JSON.parse(STDIN.read).map{|f| r=klass.new;r.date=f.fetch('value');r.import=Struct.new(:date_format).new(f.fetch('format'));r.date_iso}
puts JSON.generate({formats:formats.map(&:last),results:results})
`;
const actual=JSON.parse(execFileSync('ruby',['-e',ruby,root],{input:JSON.stringify(fixtures),encoding:'utf8'}));assert.deepEqual(actual.formats.sort(),CSV_DATE_FORMATS.map(f=>f.ruby).sort());for(const [i,f] of fixtures.entries())assert.equal(actual.results[i],f.expected,JSON.stringify(f));console.log(`${fixtures.length+1} actual pinned Ruby CSV date-format and Row#date_iso comparisons passed`);
