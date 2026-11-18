CREATE TABLE `trade_csv_accounts` (
	`owner_id` text NOT NULL,
	`import_id` text NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`import_id`) REFERENCES `trade_csv_imports`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_csv_account_owner` ON `trade_csv_accounts` (`owner_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `trade_csv_account_import` ON `trade_csv_accounts` (`owner_id`,`import_id`);--> statement-breakpoint
CREATE TABLE `trade_csv_entries` (
	`owner_id` text NOT NULL,
	`import_id` text NOT NULL,
	`trade_id` text NOT NULL,
	`row_number` integer NOT NULL,
	FOREIGN KEY (`owner_id`,`import_id`) REFERENCES `trade_csv_imports`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`trade_id`) REFERENCES `trades`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "trade_csv_row" CHECK("trade_csv_entries"."row_number" BETWEEN 2 AND 110001)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_csv_entry_owner` ON `trade_csv_entries` (`owner_id`,`trade_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_csv_entry_row` ON `trade_csv_entries` (`owner_id`,`import_id`,`row_number`);--> statement-breakpoint
CREATE INDEX `trade_csv_entry_import` ON `trade_csv_entries` (`owner_id`,`import_id`);--> statement-breakpoint
CREATE TABLE `trade_csv_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`filename` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`options_json` text NOT NULL,
	`storage_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`imported` integer DEFAULT 0 NOT NULL,
	`skipped` integer DEFAULT 0 NOT NULL,
	`created_accounts` integer DEFAULT 0 NOT NULL,
	`reverted_at` text,
	`last_revert_receipt` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trade_csv_bytes" CHECK("trade_csv_imports"."byte_size" BETWEEN 1 AND 10485760),
	CONSTRAINT "trade_csv_sha" CHECK(length("trade_csv_imports"."sha256")=64 AND "trade_csv_imports"."sha256" NOT GLOB '*[^a-f0-9]*'),
	CONSTRAINT "trade_csv_status" CHECK("trade_csv_imports"."status" IN ('uploading','ready','complete','deleting')),
	CONSTRAINT "trade_csv_options" CHECK(json_valid("trade_csv_imports"."options_json") AND json_type("trade_csv_imports"."options_json")='object' AND length("trade_csv_imports"."options_json")<=500000),
	CONSTRAINT "trade_csv_counts" CHECK("trade_csv_imports"."imported">=0 AND "trade_csv_imports"."skipped">=0 AND "trade_csv_imports"."imported"+"trade_csv_imports"."skipped"<=10000 AND "trade_csv_imports"."created_accounts" BETWEEN 0 AND 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trade_csv_owner_id` ON `trade_csv_imports` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_csv_owner_request` ON `trade_csv_imports` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `trade_csv_storage` ON `trade_csv_imports` (`storage_key`);--> statement-breakpoint
CREATE INDEX `trade_csv_owner_created` ON `trade_csv_imports` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `trades_owner_id` ON `trades` (`owner_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER trade_csv_limit BEFORE INSERT ON trade_csv_imports WHEN (SELECT count(*) FROM trade_csv_imports WHERE owner_id=NEW.owner_id)>=10 BEGIN SELECT RAISE(ABORT,'trade_csv_limit'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_immutable BEFORE UPDATE ON trade_csv_imports
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.request_id IS NOT OLD.request_id OR NEW.filename IS NOT OLD.filename OR NEW.byte_size IS NOT OLD.byte_size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.options_json IS NOT OLD.options_json OR NEW.storage_key IS NOT OLD.storage_key OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'trade_csv_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_guard BEFORE INSERT ON workspace_guards WHEN substr(NEW.id,1,10)='trade-csv:' AND (NEW.client_epoch!=6 OR NOT EXISTS(SELECT 1 FROM trade_csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,11) AND status='ready')) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_revert_guard BEFORE INSERT ON workspace_guards WHEN substr(NEW.id,1,13)='trade-revert:' AND (NEW.client_epoch!=38 OR NOT EXISTS(SELECT 1 FROM trade_csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,14) AND status='complete')) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_entry_claim BEFORE INSERT ON trade_csv_entries WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='trade-csv:'||NEW.import_id AND client_epoch=6) OR NOT EXISTS(SELECT 1 FROM trade_csv_imports WHERE owner_id=NEW.owner_id AND id=NEW.import_id AND status='ready') BEGIN SELECT RAISE(ABORT,'trade_csv_claim_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_account_claim BEFORE INSERT ON trade_csv_accounts WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='trade-csv:'||NEW.import_id AND client_epoch=6) OR NOT EXISTS(SELECT 1 FROM trade_csv_imports WHERE owner_id=NEW.owner_id AND id=NEW.import_id AND status='ready') BEGIN SELECT RAISE(ABORT,'trade_csv_claim_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_entry_immutable BEFORE UPDATE ON trade_csv_entries BEGIN SELECT RAISE(ABORT,'trade_csv_claim_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_account_immutable BEFORE UPDATE ON trade_csv_accounts BEGIN SELECT RAISE(ABORT,'trade_csv_claim_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_complete BEFORE UPDATE OF status,imported,skipped,created_accounts ON trade_csv_imports
WHEN NEW.status='complete' AND (OLD.status!='ready' OR NEW.completed_at IS NULL OR NEW.imported+NEW.skipped NOT BETWEEN 1 AND 10000 OR NEW.imported!=(SELECT count(*) FROM trade_csv_entries WHERE owner_id=NEW.owner_id AND import_id=NEW.id) OR NEW.created_accounts!=(SELECT count(*) FROM trade_csv_accounts WHERE owner_id=NEW.owner_id AND import_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='trade-csv:'||NEW.id AND client_epoch=6)) BEGIN SELECT RAISE(ABORT,'trade_csv_completion_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_reset BEFORE UPDATE OF status ON trade_csv_imports
WHEN OLD.status='complete' AND NEW.status='ready' AND (NEW.completed_at IS NOT NULL OR NEW.imported+NEW.skipped+NEW.created_accounts!=0 OR NEW.last_revert_receipt IS NULL OR NEW.last_revert_receipt IS OLD.last_revert_receipt OR EXISTS(SELECT 1 FROM trade_csv_entries WHERE owner_id=NEW.owner_id AND import_id=NEW.id) OR EXISTS(SELECT 1 FROM trade_csv_accounts WHERE owner_id=NEW.owner_id AND import_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='trade-revert:'||NEW.id AND client_epoch=38)) BEGIN SELECT RAISE(ABORT,'trade_csv_reset_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER trade_csv_transition BEFORE UPDATE OF status ON trade_csv_imports
WHEN NEW.status!=OLD.status AND NOT (NEW.status='deleting' OR OLD.status='uploading' AND NEW.status='ready' OR OLD.status='ready' AND NEW.status='complete' OR OLD.status='complete' AND NEW.status='ready') BEGIN SELECT RAISE(ABORT,'trade_csv_transition_invalid'); END;
