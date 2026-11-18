CREATE TABLE `transaction_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`file_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`file_id`) REFERENCES `statement_files`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `receipts_owner_transaction_file` ON `transaction_receipts` (`owner_id`,`transaction_id`,`file_id`);--> statement-breakpoint
CREATE INDEX `receipts_owner_file` ON `transaction_receipts` (`owner_id`,`file_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `statement_files_owner_id` ON `statement_files` (`owner_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER receipt_limit_insert BEFORE INSERT ON transaction_receipts
WHEN (SELECT count(*) FROM transaction_receipts WHERE owner_id=NEW.owner_id AND transaction_id=NEW.transaction_id)>=10 OR (SELECT count(*) FROM transaction_receipts WHERE owner_id=NEW.owner_id)>=5000
BEGIN SELECT RAISE(ABORT,'receipt_limit'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_limit_update BEFORE UPDATE OF owner_id,transaction_id ON transaction_receipts
WHEN (SELECT count(*) FROM transaction_receipts WHERE owner_id=NEW.owner_id AND transaction_id=NEW.transaction_id AND id!=OLD.id)>=10 OR (SELECT count(*) FROM transaction_receipts WHERE owner_id=NEW.owner_id AND id!=OLD.id)>=5000
BEGIN SELECT RAISE(ABORT,'receipt_limit'); END;

--> statement-breakpoint
CREATE TRIGGER receipt_file_insert BEFORE INSERT ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM statement_files f WHERE f.owner_id=NEW.owner_id AND f.id=NEW.file_id AND f.byte_size BETWEEN 1 AND 10485760 AND f.content_type IN ('image/jpeg','image/png','image/gif','image/webp','application/pdf'))
BEGIN SELECT RAISE(ABORT,'receipt_file'); END;

--> statement-breakpoint
CREATE TRIGGER receipt_file_update BEFORE UPDATE ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM statement_files f WHERE f.owner_id=NEW.owner_id AND f.id=NEW.file_id AND f.byte_size BETWEEN 1 AND 10485760 AND f.content_type IN ('image/jpeg','image/png','image/gif','image/webp','application/pdf'))
BEGIN SELECT RAISE(ABORT,'receipt_file'); END;

--> statement-breakpoint
CREATE TRIGGER track_transaction_receipts_insert AFTER INSERT ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transaction_receipts_update AFTER UPDATE ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transaction_receipts_delete AFTER DELETE ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
