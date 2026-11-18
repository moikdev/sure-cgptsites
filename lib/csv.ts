import {investmentActivitySchema,type InvestmentActivity} from './investment-reporting-schema.ts';
import type {ReconciledStatus} from './reconciliation-types.ts';
import type {CSVImportOptions} from './csv-schema.ts';
import {mappedImportTable} from './csv-formats.ts';
import { parseMoney, validDate,today, type Currency, type Kind } from "./finance.ts";
export interface CSVAccountContext {accountId:string;accountName:string;currency:Currency;}
export type CSVAccountResolver=(sourceAccount:string,currencyText:string,row:number)=>CSVAccountContext;
export interface CSVEntityContext {category:string;tags:string[];sourceCategory:string;sourceTags:string[];}
export type CSVEntityResolver=(category:string,tags:string[],row:number)=>CSVEntityContext;
export interface ImportRow {amountType?:{value:string;positiveTreatment:'inflow'|'outflow'};sourceCategory?:string;sourceTags?:string[];accountId?:string;accountName?:string;currency?:Currency;sourceAccount?:string; investmentActivity?:InvestmentActivity|null; reconciledStatus:ReconciledStatus; date: string; name: string; amount: number; category: string; notes: string; kind: Kind; merchant: string; tags: string[]; excluded: boolean; }
// RFC 4180 quoted fields, including embedded commas, CRLF, and newlines.
export function parseCSV(input: string, delimiter: ','|';'|'\t'|'|' = ','): string[][] {
  if(![',',';','\t','|'].includes(delimiter))throw new Error('Unsupported CSV delimiter.');
  const source=input.replace(/^\uFEFF/,''),rows:string[][]=[];let row:string[]=[],parts:string[]=[],start=0,quoted=false,closed=false;
  // Keep contiguous spans instead of appending every character. Large unused
  // fields otherwise build millions of string nodes before mapping discards them.
  const field=(end:number)=>{parts.push(source.slice(start,end));const value=parts.length===1?parts[0]:parts.join('');parts=[];return value;};
  for(let i=0;i<source.length;i++){
    const ch=source[i];
    if(quoted){if(ch==='"'){if(source[i+1]==='"'){parts.push(source.slice(start,i),'"');i++;start=i+1;}else{parts.push(source.slice(start,i));quoted=false;closed=true;start=i+1;}}}
    else if(ch==='"'&&i===start&&!parts.length&&!closed){quoted=true;start=i+1;}
    else if(ch===delimiter){row.push(field(i));start=i+1;closed=false;}
    else if(ch==='\n'||ch==='\r'){row.push(field(i));if(ch==='\r'&&source[i+1]==='\n')i++;if(row.some(v=>v.trim()))rows.push(row);row=[];start=i+1;closed=false;}
    else if(closed||ch==='"')throw new Error('Malformed CSV quoting.');
  }
  if(quoted)throw new Error('A quoted CSV field is not closed.');
  row.push(field(source.length));if(row.some(v=>v.trim()))rows.push(row);return rows;
}
export function importRows(input: string, currency: Currency, accountName?: string, options?: CSVImportOptions,maxRows=500,resolveAccount?:CSVAccountResolver,resolveEntities?:CSVEntityResolver): ImportRow[] {
  const table = parseCSV(input,options?.delimiter);
  const [header, ...rows] = options ? mappedImportTable(table,currency,options,maxRows,resolveAccount?(name,currency,row)=>resolveAccount(name,currency,row).currency:undefined) : table;
  if (!header) throw new Error("The CSV is empty.");
  const columns = header.map(s => s.trim().toLowerCase());
  if (new Set(columns).size !== columns.length) throw new Error("CSV headers must be unique.");
  const dateIndex = columns.indexOf("date"), nameIndex = columns.indexOf("name") >= 0 ? columns.indexOf("name") : columns.indexOf("description"), amountIndex = columns.indexOf("amount");
  if ([dateIndex, nameIndex, amountIndex].some(i => i < 0)) throw new Error("CSV needs date, name (or description), and amount columns.");
  if(!Number.isInteger(maxRows)||maxRows<1||maxRows>10000)throw new Error("Unsupported CSV row limit.");
  if (!rows.length || rows.length > maxRows) throw new Error(`Import between 1 and ${maxRows} transactions at a time.`);
  return rows.map((row, index) => {
    const read = (name: string) => row[columns.indexOf(name)]?.trim() ?? "";
    if (row.length !== header.length) throw new Error(`Row ${index + 2}: column count does not match the header.`);
    const target=resolveAccount?.(read("account"),read("currency"),index+2),rowCurrency=target?.currency??currency;
    const date = row[dateIndex].trim(), name = row[nameIndex].trim();
    if (!target && accountName && read("account") && read("account") !== accountName) throw new Error(`Row ${index + 2}: account does not match the selected account. Export or split one account at a time.`);
    if (!validDate(date)) throw new Error(`Row ${index + 2}: use a real date in YYYY-MM-DD format.`);
    if (!name || name.length > 160) throw new Error(`Row ${index + 2}: name is required and must be at most 160 characters.`);
    let amount: number;
    try { amount = parseMoney(row[amountIndex], rowCurrency); } catch (e) { throw new Error(`Row ${index + 2}: ${(e as Error).message}`); }
    const kind = read("kind") || "standard";
    // Transfers must be created as a balanced pair, never via a standalone CSV row.
    if (!["standard", "one_time", "loan_payment", "investment_contribution"].includes(kind)) throw new Error(`Row ${index + 2}: CSV supports standard, one_time, loan_payment and investment_contribution transactions. Use Transfer for paired movements.`);
    if (read("currency") && read("currency").toUpperCase() !== rowCurrency) throw new Error(`Row ${index + 2}: currency does not match the selected account.`);
    if (read("notes").length > 2000 || read("category").length > (resolveEntities?255:80)) throw new Error(`Row ${index + 2}: category or notes are too long.`);
    let tags: string[] = [];
    if (read("tags")) {
      let value: unknown; try { value=JSON.parse(read("tags")); } catch { throw new Error(`Row ${index+2}: tags must be a JSON array of names, e.g. ["Trip","Work"].`); }
      if (!Array.isArray(value) || value.length>100 || value.some(tag => typeof tag!=="string" || !tag.trim() || (resolveEntities?tag.trim().length:tag.length)>(resolveEntities?255:80)) || !resolveEntities&&new Set(value).size!==value.length) throw new Error(`Row ${index+2}: invalid tag names.`);
      tags=value as string[];
    }
    const reconciledStatus=read("reconciled_status")||'unreconciled';if(!['unreconciled','cleared','reconciled'].includes(reconciledStatus))throw new Error(`Row ${index+2}: reconciled_status must be unreconciled, cleared or reconciled.`);if(reconciledStatus!=='unreconciled'&&date>today())throw new Error(`Row ${index+2}: future transactions cannot be marked cleared or reconciled.`);
    const excluded=read("excluded").toLowerCase();
    if (!["","true","false","1","0"].includes(excluded)) throw new Error(`Row ${index+2}: excluded must be true or false.`);
    if (read("merchant").length>160) throw new Error(`Row ${index+2}: merchant name is too long.`);
    const activity=investmentActivitySchema.safeParse(read('investment_activity')||undefined);if(!activity.success)throw new Error(`Row ${index+2}: choose a supported investment_activity label.`);
    const entity=resolveEntities?.(read("category"),tags,index+2);
    return { ...(options?.amountMode==='custom'?{amountType:{value:read('entity_type'),positiveTreatment:((read('entity_type')===options.amountTypeValue!.trim())===(options.amountTypeTreatment==='inflow')?'inflow':'outflow') as 'inflow'|'outflow'}}:{}),...(entity??{}),...(target?{...target,sourceAccount:read("account")} : {}),investmentActivity:activity.data,reconciledStatus:reconciledStatus as ReconciledStatus,date, name, amount, category: entity?.category??read("category"), notes: read("notes"), kind: kind as Kind, merchant: read("merchant"), tags:entity?.tags??tags, excluded:["true","1"].includes(excluded) };
  });
}
export function csvCell(value: string | number) {
  const text = String(value);
  // Prevent spreadsheet formula execution when opening an export.
  const safe = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}
export function toCSV(rows: (string | number)[][]) { return "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\r\n"); }
