CREATE TABLE `csv_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
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
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "csv_import_bytes" CHECK("csv_imports"."byte_size" BETWEEN 1 AND 10485760),
	CONSTRAINT "csv_import_options" CHECK(json_valid("csv_imports"."options_json") AND length("csv_imports"."options_json")<=40000),
	CONSTRAINT "csv_import_status" CHECK("csv_imports"."status" IN ('uploading','ready','complete','deleting')),
	CONSTRAINT "csv_import_counts" CHECK("csv_imports"."imported">=0 AND "csv_imports"."skipped">=0 AND "csv_imports"."imported"+"csv_imports"."skipped"<=10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `csv_imports_owner_request` ON `csv_imports` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `csv_imports_storage` ON `csv_imports` (`storage_key`);--> statement-breakpoint
CREATE INDEX `csv_imports_owner_created` ON `csv_imports` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER csv_staging_limit BEFORE INSERT ON csv_imports WHEN (SELECT count(*) FROM csv_imports WHERE owner_id=NEW.owner_id)>=10 BEGIN SELECT RAISE(ABORT,'csv_staging_limit'); END;
--> statement-breakpoint
CREATE TRIGGER csv_staging_account BEFORE INSERT ON csv_imports WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND archived=0) BEGIN SELECT RAISE(ABORT,'csv_account_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER csv_staging_commit_guard BEFORE INSERT ON workspace_guards WHEN substr(NEW.id,1,4)='csv:' AND NOT EXISTS(SELECT 1 FROM csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,5) AND status='ready') BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
