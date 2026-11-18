import type {TransferMatchRejection} from './transfer-rejection-types';
export const transferRejectionColumns=['id','owner_id','outflow_transaction_id','inflow_transaction_id','created_at','updated_at'];
export const transferRejectionSelect='id,owner_id AS ownerId,outflow_transaction_id AS outflowTransactionId,inflow_transaction_id AS inflowTransactionId,created_at AS createdAt,updated_at AS updatedAt';
export const transferRejectionValues=(r:TransferMatchRejection)=>[r.id,r.ownerId,r.outflowTransactionId,r.inflowTransactionId,r.createdAt,r.updatedAt];
