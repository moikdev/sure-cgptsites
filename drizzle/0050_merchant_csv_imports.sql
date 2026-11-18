CREATE TABLE `merchant_csv_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`filename` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`delimiter` text NOT NULL,
	`storage_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`created` integer DEFAULT 0 NOT NULL,
	`reused` integer DEFAULT 0 NOT NULL,
	`blank` integer DEFAULT 0 NOT NULL,
	`reverted_at` text,
	`last_revert_receipt` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "merchant_csv_bytes" CHECK("merchant_csv_imports"."byte_size" BETWEEN 1 AND 10485760),
	CONSTRAINT "merchant_csv_sha" CHECK(length("merchant_csv_imports"."sha256")=64 AND "merchant_csv_imports"."sha256" NOT GLOB '*[^a-f0-9]*'),
	CONSTRAINT "merchant_csv_status" CHECK("merchant_csv_imports"."status" IN ('uploading','ready','complete','deleting')),
	CONSTRAINT "merchant_csv_delimiter" CHECK("merchant_csv_imports"."delimiter" IN (',',char(59),char(9),'|')),
	CONSTRAINT "merchant_csv_counts" CHECK("merchant_csv_imports"."created">=0 AND "merchant_csv_imports"."reused">=0 AND "merchant_csv_imports"."blank">=0 AND "merchant_csv_imports"."created"+"merchant_csv_imports"."reused"+"merchant_csv_imports"."blank"<=10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_csv_owner_request` ON `merchant_csv_imports` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_csv_storage` ON `merchant_csv_imports` (`storage_key`);--> statement-breakpoint
CREATE INDEX `merchant_csv_owner_created` ON `merchant_csv_imports` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER merchant_csv_limit BEFORE INSERT ON merchant_csv_imports
WHEN (SELECT count(*) FROM merchant_csv_imports WHERE owner_id=NEW.owner_id)>=10
BEGIN SELECT RAISE(ABORT,'merchant_csv_limit'); END;
--> statement-breakpoint
CREATE TRIGGER merchant_csv_immutable BEFORE UPDATE ON merchant_csv_imports
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.request_id IS NOT OLD.request_id
OR NEW.filename IS NOT OLD.filename OR NEW.byte_size IS NOT OLD.byte_size OR NEW.sha256 IS NOT OLD.sha256
OR NEW.delimiter IS NOT OLD.delimiter OR NEW.storage_key IS NOT OLD.storage_key OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'merchant_csv_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER merchant_csv_commit_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,13)='merchant-csv:' AND (NEW.client_epoch!=41 OR NOT EXISTS(
 SELECT 1 FROM merchant_csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,14) AND status='ready'))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER merchant_csv_revert_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,16)='merchant-revert:' AND (NEW.client_epoch!=41 OR NOT EXISTS(
 SELECT 1 FROM merchant_csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,17) AND status='complete'))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER merchant_csv_complete BEFORE UPDATE OF status ON merchant_csv_imports
WHEN NEW.status='complete' AND (OLD.status!='ready' OR NEW.completed_at IS NULL OR NEW.created+NEW.reused+NEW.blank<1
 OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='merchant-csv:'||NEW.id AND client_epoch=41))
BEGIN SELECT RAISE(ABORT,'merchant_csv_completion_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER merchant_csv_reset BEFORE UPDATE OF status ON merchant_csv_imports
WHEN OLD.status='complete' AND NEW.status='ready' AND (NEW.completed_at IS NOT NULL OR NEW.created+NEW.reused+NEW.blank!=0
 OR NEW.last_revert_receipt IS NULL OR NEW.last_revert_receipt IS OLD.last_revert_receipt
 OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='merchant-revert:'||NEW.id AND client_epoch=41))
BEGIN SELECT RAISE(ABORT,'merchant_csv_reset_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER merchant_csv_transition BEFORE UPDATE OF status ON merchant_csv_imports
WHEN NEW.status!=OLD.status AND NOT (NEW.status='deleting' OR OLD.status='uploading' AND NEW.status='ready'
 OR OLD.status='ready' AND NEW.status='complete' OR OLD.status='complete' AND NEW.status='ready')
BEGIN SELECT RAISE(ABORT,'merchant_csv_transition_invalid'); END;
