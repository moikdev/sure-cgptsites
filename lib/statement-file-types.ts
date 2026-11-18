export const FILE_TYPES=['image/jpeg','image/png','image/gif','image/webp','application/pdf','text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] as const;
export type StatementFileType=typeof FILE_TYPES[number];
export type FileStatus='pending'|'ready'|'failed'|'missing'|'deleting';
export interface StatementFile {id:string;ownerId:string;statementId:string|null;filename:string;contentType:StatementFileType;byteSize:number;sha256:string;uploadStatus:FileStatus;createdAt:string;updatedAt:string;}
export interface StoredStatementFile extends StatementFile {storageKey:string|null;attemptToken:string|null;attemptStartedAt:string|null;}

export interface TransactionReceipt {id:string;ownerId:string;transactionId:string;fileId:string;createdAt:string;}
