ALTER TABLE csv_imports ADD COLUMN reversal_tracked integer CONSTRAINT csv_reversal_tracked CHECK(reversal_tracked IS NULL OR reversal_tracked IN(0,1));
--> statement-breakpoint
ALTER TABLE csv_imports ADD COLUMN reverted_at text;
--> statement-breakpoint
ALTER TABLE csv_imports ADD COLUMN last_revert_receipt text;
--> statement-breakpoint
CREATE UNIQUE INDEX csv_imports_owner_id ON csv_imports(owner_id,id);
--> statement-breakpoint
CREATE TABLE `csv_import_entries` (
	`owner_id` text NOT NULL,
	`import_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`import_id`) REFERENCES `csv_imports`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `csv_import_entry_owner_transaction` ON `csv_import_entries` (`owner_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `csv_import_entry_owner_import` ON `csv_import_entries` (`owner_id`,`import_id`);--> statement-breakpoint

--> statement-breakpoint
CREATE TRIGGER csv_owned_completion BEFORE UPDATE OF status ON csv_imports WHEN NEW.status='complete' AND NEW.reversal_tracked=1 AND NEW.imported!=(SELECT count(*) FROM csv_import_entries WHERE owner_id=NEW.owner_id AND import_id=NEW.id) BEGIN SELECT RAISE(ABORT,'csv_ownership_incomplete'); END;
--> statement-breakpoint
CREATE TRIGGER csv_revert_guard BEFORE INSERT ON workspace_guards WHEN substr(NEW.id,1,11)='csv-revert:' AND NOT EXISTS(SELECT 1 FROM csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,12) AND status='complete' AND reversal_tracked=1) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
