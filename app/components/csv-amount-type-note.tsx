import type {ImportRow} from '../../lib/csv';
export function CSVAmountTypeNote({row}:{row:ImportRow}){
 return row.amountType?<p>Source amount type: <code>{row.amountType.value?JSON.stringify(row.amountType.value):'(blank)'}</code>. Positive source amounts are {row.amountType.positiveTreatment==='inflow'?'income':'expenses'}; negative amounts reverse this treatment.</p>:null;
}
