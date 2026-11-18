import type {StatementFile,TransactionReceipt} from './statement-file-types.ts';
export const MAX_RECEIPT_BYTES=10*1024*1024,MAX_TRANSACTION_RECEIPTS=10;
export const isImageType=(type:string)=>['image/jpeg','image/png','image/gif','image/webp'].includes(type);
export const receiptEligible=(file:{contentType:string;byteSize:number})=>(isImageType(file.contentType)||file.contentType==='application/pdf')&&file.byteSize>=1&&file.byteSize<=MAX_RECEIPT_BYTES;
export function validateTransactionReceipts(state:{transactionReceipts:Omit<TransactionReceipt,'ownerId'>[];transactions:{id:string}[];statementFiles:Omit<StatementFile,'ownerId'>[]}){
 const transactions=new Set(state.transactions.map(t=>t.id)),files=new Map(state.statementFiles.map(f=>[f.id,f])),ids=new Set<string>(),pairs=new Set<string>(),counts=new Map<string,number>();
 for(const receipt of state.transactionReceipts){const file=files.get(receipt.fileId),pair=JSON.stringify([receipt.transactionId,receipt.fileId]);if(ids.has(receipt.id)||pairs.has(pair))throw new Error('Duplicate transaction receipt links.');ids.add(receipt.id);pairs.add(pair);if(!transactions.has(receipt.transactionId)||!file)throw new Error('A receipt refers to a missing transaction or file.');if(!receiptEligible(file))throw new Error('Receipts must be JPEG, PNG, GIF, WebP or PDF files up to 10 MB.');const count=(counts.get(receipt.transactionId)??0)+1;if(count>MAX_TRANSACTION_RECEIPTS)throw new Error('A transaction can have at most 10 receipts.');counts.set(receipt.transactionId,count);}
}
