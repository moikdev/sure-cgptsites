import {parseMoney,validDate,moneyInput,type Currency} from './finance.ts';
import {CSV_FIELDS,csvImportOptionsSchema,type CSVImportOptions} from './csv-schema.ts';
import {CSV_DATE_FORMATS} from './csv-date-formats.ts';

export function csvDate(value:string,format:CSVImportOptions['dateFormat']):string {
  const text=value.trim();
  const choice=CSV_DATE_FORMATS.find(f=>f.value===format);
  if(choice&&text.length<=64){
    if(format==='ymd'){if(validDate(text))return text;}
    else {
      let parts:RegExpExecArray|null=null,year='',month='',day='';
      if(format==='ymd-compact')parts=/^(\d{4})(\d{2})(\d{2})$/.exec(text);
      else if(format==='ymd-slash')parts=/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
      else if(format==='ymd-dot')parts=/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/.exec(text);
      if(parts){[,year,month,day]=parts;}
      else if(format==='dmy-month'){
        parts=/^(\d{1,2}) +([A-Za-z]+) +(\d{4})$/.exec(text);
        if(parts){day=parts[1];year=parts[3];const name=parts[2].toLowerCase(),index=['january','february','march','april','may','june','july','august','september','october','november','december'].findIndex(m=>m===name||m.slice(0,3)===name);if(index>=0)month=String(index+1);}
      }else {
        if(format==='mdy'||format==='dmy'||format==='dmy-space')parts=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
        else if(format==='mdy-dash'||format==='dmy-dash')parts=/^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(text);
        else if(format==='dmy-dot')parts=/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text);
        else if(format==='dmy-short-year')parts=/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(text);
        if(parts){const mdy=format==='mdy'||format==='mdy-dash';day=parts[mdy?2:1];month=parts[mdy?1:2];year=format==='dmy-short-year'?String(Number(parts[3])+(Number(parts[3])<=68?2000:1900)):parts[3];}
      }
      if(year&&month&&day){const date=`${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;if(validDate(date))return date;}
    }
  }
  throw new Error(`Use a real date in ${choice?.label??'a supported CSV date'} format.`);
}

// Validate grouping before removing it. Never round decimals or strip currency/text.
export function csvAmount(value:string,currency:Currency,format:CSVImportOptions['numberFormat']):number {
  let text=value.trim(),negative=false;
  if(text.startsWith('(')&&text.endsWith(')')){negative=true;text=text.slice(1,-1);}
  else if(text.startsWith('-')||text.startsWith('+')){negative=text[0]==='-';text=text.slice(1);}
  const patterns={
    'decimal-dot':/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/,
    'decimal-comma':/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/,
    'space-comma':/^(?:\d+|\d{1,3}(?: \d{3})+)(?:,\d+)?$/,
    'integer-comma':/^(?:\d+|\d{1,3}(?:,\d{3})+)$/,
  };
  if(format==='space-comma')text=text.replace(/[\u00a0\u202f]/g,' ');
  if(!patterns[format].test(text))throw new Error('Amount does not match the selected number format. Use numbers without currency symbols.');
  if(format==='decimal-dot'||format==='integer-comma')text=text.replaceAll(',','');
  else text=text.replaceAll(format==='decimal-comma'?'.':' ','').replace(',','.');
  return parseMoney((negative?'-':'')+text,currency);
}

export function mappedImportTable(table:string[][],currency:Currency,rawOptions:CSVImportOptions,maxRows=500,currencyForRow?:(sourceAccount:string,currencyText:string,row:number)=>Currency):string[][] {
  const parsed=csvImportOptionsSchema.safeParse(rawOptions);
  if(!parsed.success)throw new Error(parsed.error.issues[0].message);
  const options=parsed.data,[header,...rows]=table;
  if(!header)throw new Error('The CSV is empty.');
  if(header.length>100)throw new Error('CSV supports at most 100 columns.');
  const names=header.map(v=>v.trim().toLowerCase());
  if(new Set(names).size!==names.length)throw new Error('CSV headers must be unique.');
  if(Object.values(options.columns).some(index=>index!==undefined&&index>=header.length))throw new Error('A mapped column is missing from this CSV.');
  if(!Number.isInteger(maxRows)||maxRows<1||maxRows>10000)throw new Error('Unsupported CSV row limit.');
  if(!rows.length||rows.length>maxRows)throw new Error(`Import between 1 and ${maxRows} transactions at a time.`);
  const fields=CSV_FIELDS.filter(field=>field!=='debit'&&field!=='credit'&&(field!=='entity_type'||options.amountMode==='custom'));
  return [fields, ...rows.map((row,index)=>{
    try {
      if(row.length!==header.length)throw new Error('Column count does not match the header.');
      const read=(field:keyof CSVImportOptions['columns'])=>{const column=options.columns[field];return column===undefined?'':row[column].trim();};
      const rowCurrency=currencyForRow?.(read('account'),read('currency'),index+2)??currency;
      const date=csvDate(read('date'),options.dateFormat);
      let amount:number;
      if(options.amountMode==='signed')amount=csvAmount(read('amount'),rowCurrency,options.numberFormat)*(options.signage==='outflows-positive'?-1:1);
      else if(options.amountMode==='custom'){
        const type=read('entity_type');if(type.length>2000)throw new Error('Amount-type values must be at most 2,000 characters.');
        const positiveInflow=(type===options.amountTypeValue)===(options.amountTypeTreatment==='inflow');
        amount=csvAmount(read('amount'),rowCurrency,options.numberFormat)*(positiveInflow?1:-1);
      }
      else {
        if(!read('debit')&&!read('credit'))throw new Error('Provide a debit or credit amount; enter 0 explicitly for a memo entry.');
        const debit=read('debit')?csvAmount(read('debit'),rowCurrency,options.numberFormat):0,credit=read('credit')?csvAmount(read('credit'),rowCurrency,options.numberFormat):0;
        if(debit<0||credit<0||(debit!==0&&credit!==0))throw new Error('Use one non-negative debit or credit per row.');
        amount=credit-debit;
      }
      return fields.map(field=>field==='date'?date:field==='amount'?moneyInput(amount,rowCurrency):read(field));
    } catch(error){throw new Error(`Row ${index+2}: ${(error as Error).message}`);}
  })];
}
