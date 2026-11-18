CREATE TABLE `account_csv_accounts` (
	`owner_id` text NOT NULL,
	`import_id` text NOT NULL,
	`account_id` text NOT NULL,
	`row_number` integer NOT NULL,
	FOREIGN KEY (`owner_id`,`import_id`) REFERENCES `account_csv_imports`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_csv_row" CHECK("account_csv_accounts"."row_number" BETWEEN 0 AND 49)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_csv_account_owner` ON `account_csv_accounts` (`owner_id`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_csv_account_row` ON `account_csv_accounts` (`owner_id`,`import_id`,`row_number`);--> statement-breakpoint
CREATE TABLE `account_csv_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`filename` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`options_json` text NOT NULL,
	`type_mappings_json` text NOT NULL,
	`storage_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`created` integer DEFAULT 0 NOT NULL,
	`reverted_at` text,
	`last_revert_receipt` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_csv_bytes" CHECK("account_csv_imports"."byte_size" BETWEEN 1 AND 10485760),
	CONSTRAINT "account_csv_hash" CHECK(length("account_csv_imports"."sha256")=64 AND "account_csv_imports"."sha256" NOT GLOB '*[^a-f0-9]*'),
	CONSTRAINT "account_csv_status" CHECK("account_csv_imports"."status" IN ('uploading','ready','complete','deleting')),
	CONSTRAINT "account_csv_options" CHECK(json_valid("account_csv_imports"."options_json") AND json_type("account_csv_imports"."options_json")='object' AND length("account_csv_imports"."options_json")<=40000),
	CONSTRAINT "account_csv_types" CHECK(json_valid("account_csv_imports"."type_mappings_json") AND json_type("account_csv_imports"."type_mappings_json")='array' AND json_array_length("account_csv_imports"."type_mappings_json") BETWEEN 1 AND 50 AND length("account_csv_imports"."type_mappings_json")<=200000),
	CONSTRAINT "account_csv_count" CHECK("account_csv_imports"."created" BETWEEN 0 AND 50)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_csv_owner_id` ON `account_csv_imports` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_csv_owner_request` ON `account_csv_imports` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `account_csv_storage` ON `account_csv_imports` (`storage_key`);--> statement-breakpoint
CREATE INDEX `account_csv_owner_created` ON `account_csv_imports` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER account_csv_limit BEFORE INSERT ON account_csv_imports WHEN (SELECT count(*) FROM account_csv_imports WHERE owner_id=NEW.owner_id)>=10 BEGIN SELECT RAISE(ABORT,'account_csv_limit'); END;
--> statement-breakpoint
CREATE TRIGGER account_csv_immutable BEFORE UPDATE ON account_csv_imports
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.request_id IS NOT OLD.request_id OR NEW.filename IS NOT OLD.filename OR NEW.byte_size IS NOT OLD.byte_size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.options_json IS NOT OLD.options_json OR NEW.type_mappings_json IS NOT OLD.type_mappings_json OR NEW.storage_key IS NOT OLD.storage_key OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'account_csv_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER account_csv_guard BEFORE INSERT ON workspace_guards WHEN substr(NEW.id,1,12)='account-csv:' AND (NEW.client_epoch!=38 OR NOT EXISTS(SELECT 1 FROM account_csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,13) AND status='ready')) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER account_csv_revert_guard BEFORE INSERT ON workspace_guards WHEN substr(NEW.id,1,15)='account-revert:' AND (NEW.client_epoch!=38 OR NOT EXISTS(SELECT 1 FROM account_csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,16) AND status='complete')) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER account_csv_claim BEFORE INSERT ON account_csv_accounts
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='account-csv:'||NEW.import_id AND client_epoch=38)
OR NOT EXISTS(SELECT 1 FROM account_csv_imports WHERE owner_id=NEW.owner_id AND id=NEW.import_id AND status='ready') BEGIN SELECT RAISE(ABORT,'account_csv_claim_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER account_csv_claim_immutable BEFORE UPDATE ON account_csv_accounts BEGIN SELECT RAISE(ABORT,'account_csv_claim_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER account_csv_complete BEFORE UPDATE OF status,created ON account_csv_imports
WHEN NEW.status='complete' AND (OLD.status!='ready' OR NEW.completed_at IS NULL OR NEW.created NOT BETWEEN 1 AND 50 OR NEW.created!=(SELECT count(*) FROM account_csv_accounts WHERE owner_id=NEW.owner_id AND import_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='account-csv:'||NEW.id AND client_epoch=38)) BEGIN SELECT RAISE(ABORT,'account_csv_completion_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER account_csv_reset BEFORE UPDATE OF status ON account_csv_imports
WHEN OLD.status='complete' AND NEW.status='ready' AND (NEW.completed_at IS NOT NULL OR NEW.created!=0 OR NEW.last_revert_receipt IS NULL OR NEW.last_revert_receipt IS OLD.last_revert_receipt OR EXISTS(SELECT 1 FROM account_csv_accounts WHERE owner_id=NEW.owner_id AND import_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='account-revert:'||NEW.id AND client_epoch=38)) BEGIN SELECT RAISE(ABORT,'account_csv_reset_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER account_csv_transition BEFORE UPDATE OF status ON account_csv_imports
WHEN NEW.status!=OLD.status AND NOT (NEW.status='deleting' OR OLD.status='uploading' AND NEW.status='ready' OR OLD.status='ready' AND NEW.status='complete' OR OLD.status='complete' AND NEW.status='ready') BEGIN SELECT RAISE(ABORT,'account_csv_transition_invalid'); END;
