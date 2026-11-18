import {ApiError,commitMutation,database,readState} from './repository';import {investmentTransferRepairSchema} from './transfer-kind-repair-schema';import {investmentTransferRepairPage,planInvestmentTransferRepair} from './transfer-kind-repair';import {validateWorkspace} from './workspace';
export async function executeInvestmentTransferRepair(owner:string,input:unknown,revision:number){
 const parsed=investmentTransferRepairSchema.safeParse(input);if(!parsed.success)return null;const c=parsed.data,state=await readState(owner);
 if(state.profile?.revision!==revision||c.expectedRevision!==undefined&&c.expectedRevision!==revision)throw new ApiError(409,'Your workspace changed. Review investment transfer reporting again.');
 if(c.destinationAccountId&&!state.accounts.some(a=>a.id===c.destinationAccountId))throw new ApiError(404,'Destination account not found.');
 let plan,page;try{plan=planInvestmentTransferRepair(state,c);validateWorkspace({...plan.next,budgets:[]});page=investmentTransferRepairPage(plan.review,c.offset,c.effectOffset);}catch(error){throw new ApiError(400,error instanceof Error?error.message:'Investment transfer reporting could not be reviewed.');}
 const receipt=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['investment-transfer-repair-v1',owner,revision,plan.review]))))].map(n=>n.toString(16).padStart(2,'0')).join('');if(c.mode==='preview')return {...page,expectedRevision:revision,receipt};
 if(c.expectedRevision!==revision||c.receipt!==receipt||c.reviewedOn!==plan.review.reviewedOn)throw new ApiError(409,'The scope, entries, date or workspace changed. Review the repair again.');
 if(!plan.changes.length)return {message:'No eligible investment transfer reporting needs repair. No records changed.',changed:0};
 const db=database(),statements:D1PreparedStatement[]=[];
 for(const kind of ['funds_movement','investment_contribution'] as const){const ids=plan.changes.filter(c=>c.afterKind===kind).map(c=>c.transactionId);for(let i=0;i<ids.length;i+=90){const batch=ids.slice(i,i+90);statements.push(db.prepare(`UPDATE transactions SET kind=? WHERE owner_id=? AND id IN (${batch.map(()=>'?').join(',')})`).bind(kind,owner,...batch));}}
 for(let i=0;i<plan.review.closedStatements.length;i+=90){const ids=plan.review.closedStatements.slice(i,i+90).map(s=>s.id);statements.push(db.prepare(`UPDATE account_statements SET review_required=1 WHERE owner_id=? AND id IN (${ids.map(()=>'?').join(',')})`).bind(owner,...ids));}
 await commitMutation(owner,revision,statements,36);
 return {message:`Repaired ${plan.changes.length} investment transfer reporting kind(s). Native amounts, balances, dates, categories, existing protections, pending status, FX evidence, fees, CSV identities and receipts are preserved.`,changed:plan.changes.length};
}
