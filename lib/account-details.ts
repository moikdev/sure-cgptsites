import catalog from './account-subtypes.json' with {type:'json'};
import type {Account,AccountType,Currency} from './finance.ts';
export const CRYPTO_TAX_TREATMENTS=['taxable','tax_deferred','tax_exempt'] as const;
export type CryptoTaxTreatment=typeof CRYPTO_TAX_TREATMENTS[number];
export type TaxTreatment=CryptoTaxTreatment|'tax_advantaged';
export const ACCOUNTABLE_TYPES:Record<AccountType,keyof typeof catalog>={checking:'Depository',savings:'Depository',investment:'Investment',crypto:'Crypto',credit:'CreditCard',loan:'Loan',property:'Property',vehicle:'Vehicle',other:'OtherAsset',other_liability:'OtherLiability'};
type Meta={short:string;long:string;region?:string|null;tax_treatment?:TaxTreatment};
export const subtypeCatalog=(type:AccountType)=>catalog[ACCOUNTABLE_TYPES[type]] as Record<string,Meta>;
export const validSubtype=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.length<=80&&value===value.trim()&&!/[\u0000-\u001f\u007f]/.test(value);
export function validateAccountDetails(type:AccountType,subtype:string|null|undefined,cryptoTaxTreatment:CryptoTaxTreatment|null|undefined){if(subtype!=null&&!validSubtype(subtype))throw Error('Choose a subtype of at most 80 characters without surrounding whitespace or controls.');if(cryptoTaxTreatment!=null&&(type!=='crypto'||!CRYPTO_TAX_TREATMENTS.includes(cryptoTaxTreatment)))throw Error('Explicit tax treatment is available only for crypto accounts.');}
export const subtypeMetadata=(type:AccountType,subtype:string|null|undefined)=>subtype!=null&&Object.hasOwn(subtypeCatalog(type),subtype)?subtypeCatalog(type)[subtype]:undefined;
export function taxTreatment(account:Pick<Account,'type'|'subtype'|'cryptoTaxTreatment'>):TaxTreatment|null{
 if(account.type==='investment')return subtypeMetadata('investment',account.subtype)?.tax_treatment??'taxable';
 if(account.type==='crypto')return account.cryptoTaxTreatment??'taxable';
 if(['checking','savings'].includes(account.type)&&account.subtype==='hsa')return 'tax_advantaged';
 return null;
}
export const taxAdvantaged=(account:Pick<Account,'type'|'subtype'|'cryptoTaxTreatment'>)=>['tax_deferred','tax_exempt','tax_advantaged'].includes(taxTreatment(account)??'');
export const subtypeLabel=(account:Pick<Account,'type'|'subtype'>)=>account.subtype?(subtypeMetadata(account.type,account.subtype)?.long??account.subtype):null;
export function subtypeGroups(type:AccountType,currency:Currency){const values=Object.entries(subtypeCatalog(type));if(type!=='investment')return [{key:'generic',label:'Account subtypes',options:values}];const region=({USD:'us',GBP:'uk',CAD:'ca',AUD:'au',EUR:'eu',CHF:'eu',INR:'in'} as Record<string,string>)[currency],labels:Record<string,string>={us:'United States',uk:'United Kingdom',ca:'Canada',au:'Australia',eu:'Europe',in:'India',generic:'Generic'},order=[region,'generic','us','uk','ca','au','eu','in'].filter((v,i,a):v is string=>!!v&&a.indexOf(v)===i);return order.map(key=>({key,label:labels[key],options:values.filter(([,v])=>(v.region??'generic')===key)})).filter(g=>g.options.length);}
