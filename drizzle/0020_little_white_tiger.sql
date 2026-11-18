CREATE TABLE `statement_files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`statement_id` text,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`upload_status` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`storage_key` text,
	`attempt_token` text,
	`attempt_started_at` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`statement_id`) REFERENCES `account_statements`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "statement_file_bytes" CHECK("statement_files"."byte_size" BETWEEN 1 AND 26214400),
	CONSTRAINT "statement_file_status" CHECK("statement_files"."upload_status" IN ('pending','ready','failed','missing','deleting') AND ("statement_files"."upload_status"!='ready' OR "statement_files"."storage_key" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `statement_files_owner_hash` ON `statement_files` (`owner_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `statement_files_owner_statement` ON `statement_files` (`owner_id`,`statement_id`);
--> statement-breakpoint
CREATE TRIGGER track_statement_files_insert AFTER INSERT ON statement_files
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_statement_files_update AFTER UPDATE ON statement_files
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_statement_files_delete AFTER DELETE ON statement_files
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER statement_file_limit BEFORE INSERT ON statement_files
WHEN (SELECT COUNT(*) FROM statement_files WHERE owner_id=NEW.owner_id)>=500
BEGIN SELECT RAISE(ABORT,'file_limit'); END;
--> statement-breakpoint
CREATE TRIGGER unlink_files_deleted_statement BEFORE DELETE ON account_statements
BEGIN UPDATE statement_files SET statement_id=NULL WHERE owner_id=OLD.owner_id AND statement_id=OLD.id; END;
