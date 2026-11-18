import {database} from './repository';import type {planNativeMerge} from './native-merge';
export const NATIVE_OWNERSHIP={accounts:'account_id',transactions:'transaction_id',trades:'trade_id',valuations:'valuation_id'} as const;
export type NativeOwnership=Awaited<ReturnType<typeof planNativeMerge>>['ownership'];
export type NativeOwnershipCounts=Record<keyof NativeOwnership,number>;
export function captureNativeOwnership(owner:string,sourceId:string,ownership:NativeOwnership){
 const db=database(),statements:D1PreparedStatement[]=[],counts={} as NativeOwnershipCounts;
 for(const key of Object.keys(NATIVE_OWNERSHIP) as (keyof NativeOwnership)[]){const ids=[...new Set(ownership[key])];counts[key]=ids.length;for(let i=0;i<ids.length;i+=33){const group=ids.slice(i,i+33);statements.push(db.prepare(`INSERT INTO native_source_${key}(owner_id,source_id,${NATIVE_OWNERSHIP[key]}) VALUES ${group.map(()=>'(?,?,?)').join(',')}`).bind(...group.flatMap(id=>[owner,sourceId,id])));}}
 statements.push(db.prepare("UPDATE native_import_sources SET reversal_tracked=1,ownership_counts_json=? WHERE owner_id=? AND id=? AND status='ready'").bind(JSON.stringify(counts),owner,sourceId));return statements;
}
export async function readNativeOwnership(owner:string,sourceId:string):Promise<NativeOwnership>{const keys=Object.keys(NATIVE_OWNERSHIP) as (keyof NativeOwnership)[],db=database(),results=await db.batch(keys.map(key=>db.prepare(`SELECT ${NATIVE_OWNERSHIP[key]} AS id FROM native_source_${key} WHERE owner_id=? AND source_id=? ORDER BY ${NATIVE_OWNERSHIP[key]}`).bind(owner,sourceId)));return Object.fromEntries(keys.map((key,index)=>[key,(results[index].results as {id:string}[]).map(row=>row.id)])) as NativeOwnership;}
