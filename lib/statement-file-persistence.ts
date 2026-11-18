import {snake} from './investment-persistence';
export const fileFields=['id','ownerId','statementId','filename','contentType','byteSize','sha256','uploadStatus','createdAt','updatedAt'] as const;
export const fileColumns=fileFields.map(snake),fileSelect=fileFields.map(f=>`${snake(f)} AS ${f}`).join(', '),storedFileSelect=fileSelect+',storage_key AS storageKey,attempt_token AS attemptToken,attempt_started_at AS attemptStartedAt';
