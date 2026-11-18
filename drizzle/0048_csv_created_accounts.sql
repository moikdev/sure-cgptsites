ALTER TABLE csv_imports ADD COLUMN account_creations text CONSTRAINT csv_account_creations CHECK(account_creations IS NULL OR (json_valid(account_creations) AND json_type(account_creations)='array' AND json_array_length(account_creations) BETWEEN 1 AND 500 AND length(account_creations)<=200000));
--> statement-breakpoint
ALTER TABLE csv_imports ADD COLUMN created_accounts integer NOT NULL DEFAULT 0 CONSTRAINT csv_created_accounts_count CHECK(created_accounts BETWEEN 0 AND 500);
--> statement-breakpoint
CREATE TABLE `csv_import_accounts` (
	`owner_id` text NOT NULL,
	`import_id` text NOT NULL,
	`proposal_id` text NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`import_id`) REFERENCES `csv_imports`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `csv_import_accounts_unique` ON `csv_import_accounts` (`owner_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `csv_import_accounts_proposal` ON `csv_import_accounts` (`owner_id`,`import_id`,`proposal_id`);--> statement-breakpoint

DROP TRIGGER csv_staging_account;
--> statement-breakpoint
CREATE TRIGGER csv_staging_account BEFORE INSERT ON csv_imports
WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND archived=0)
AND NOT EXISTS(SELECT 1 FROM json_each(NEW.account_creations) c WHERE json_extract(c.value,'$.id')=NEW.account_id)
BEGIN SELECT RAISE(ABORT,'csv_account_unavailable'); END;
--> statement-breakpoint
DROP TRIGGER csv_mapped_accounts;
--> statement-breakpoint
CREATE TRIGGER csv_mapped_accounts BEFORE INSERT ON csv_imports
WHEN NEW.account_mappings IS NOT NULL AND EXISTS (SELECT 1 FROM json_each(NEW.account_mappings) m
 WHERE NOT EXISTS(SELECT 1 FROM accounts a WHERE a.owner_id=NEW.owner_id AND a.id=json_extract(m.value,'$.accountId') AND a.archived=0)
 AND NOT EXISTS(SELECT 1 FROM json_each(NEW.account_creations) c WHERE json_extract(c.value,'$.id')=json_extract(m.value,'$.accountId')))
BEGIN SELECT RAISE(ABORT,'csv_account_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER csv_creations_immutable BEFORE UPDATE OF account_creations ON csv_imports
WHEN NEW.account_creations IS NOT OLD.account_creations BEGIN SELECT RAISE(ABORT,'csv_mapping_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER csv_created_account_claim BEFORE INSERT ON csv_import_accounts
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards g WHERE g.owner_id=NEW.owner_id AND g.id='csv:'||NEW.import_id AND g.client_epoch=38)
OR NOT EXISTS(SELECT 1 FROM csv_imports i,json_each(i.account_creations) c WHERE i.owner_id=NEW.owner_id AND i.id=NEW.import_id AND i.status='ready' AND json_extract(c.value,'$.id')=NEW.proposal_id)
BEGIN SELECT RAISE(ABORT,'csv_account_claim_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER csv_created_completion BEFORE UPDATE OF status,created_accounts ON csv_imports
WHEN NEW.status='complete' AND NEW.created_accounts!=(SELECT count(*) FROM csv_import_accounts WHERE owner_id=NEW.owner_id AND import_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'csv_account_ownership_incomplete'); END;
--> statement-breakpoint
CREATE TRIGGER csv_created_reset BEFORE UPDATE OF status ON csv_imports
WHEN OLD.status='complete' AND NEW.status='ready' AND (NEW.created_accounts!=0 OR EXISTS(SELECT 1 FROM csv_import_accounts WHERE owner_id=NEW.owner_id AND import_id=NEW.id))
BEGIN SELECT RAISE(ABORT,'csv_accounts_remain'); END;
--> statement-breakpoint
CREATE TRIGGER csv_created_revert_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,11)='csv-revert:' AND NEW.client_epoch!=38 AND EXISTS(SELECT 1 FROM csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,12) AND created_accounts>0)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
