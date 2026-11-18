CREATE TABLE `rule_csv_imports` (
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
	`created` integer DEFAULT 0 NOT NULL,
	`updated` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`disabled` integer DEFAULT 0 NOT NULL,
	`reverted_at` text,
	`last_revert_receipt` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rule_csv_bytes" CHECK("rule_csv_imports"."byte_size" BETWEEN 1 AND 10485760),
	CONSTRAINT "rule_csv_sha" CHECK(length("rule_csv_imports"."sha256")=64 AND "rule_csv_imports"."sha256" NOT GLOB '*[^a-f0-9]*'),
	CONSTRAINT "rule_csv_status" CHECK("rule_csv_imports"."status" IN ('uploading','ready','complete','deleting')),
	CONSTRAINT "rule_csv_options" CHECK(json_valid("rule_csv_imports"."options_json") AND json_type("rule_csv_imports"."options_json")='object' AND length("rule_csv_imports"."options_json")<=1000),
	CONSTRAINT "rule_csv_counts" CHECK("rule_csv_imports"."created">=0 AND "rule_csv_imports"."updated">=0 AND "rule_csv_imports"."total">=0 AND "rule_csv_imports"."created"+"rule_csv_imports"."updated"<=500 AND "rule_csv_imports"."total" BETWEEN 0 AND 10000 AND "rule_csv_imports"."disabled" BETWEEN 0 AND "rule_csv_imports"."created"+"rule_csv_imports"."updated")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rule_csv_owner_request` ON `rule_csv_imports` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `rule_csv_storage` ON `rule_csv_imports` (`storage_key`);--> statement-breakpoint
CREATE INDEX `rule_csv_owner_created` ON `rule_csv_imports` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER rule_csv_limit BEFORE INSERT ON rule_csv_imports
WHEN (SELECT count(*) FROM rule_csv_imports WHERE owner_id=NEW.owner_id)>=10
BEGIN SELECT RAISE(ABORT,'rule_csv_limit'); END;
--> statement-breakpoint
CREATE TRIGGER rule_csv_immutable BEFORE UPDATE ON rule_csv_imports
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.request_id IS NOT OLD.request_id
OR NEW.filename IS NOT OLD.filename OR NEW.byte_size IS NOT OLD.byte_size OR NEW.sha256 IS NOT OLD.sha256
OR NEW.options_json IS NOT OLD.options_json OR NEW.storage_key IS NOT OLD.storage_key OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT,'rule_csv_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER rule_csv_commit_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,9)='rule-csv:' AND (NEW.client_epoch!=42 OR NOT EXISTS(
 SELECT 1 FROM rule_csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,10) AND status='ready'))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER rule_csv_revert_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,12)='rule-revert:' AND (NEW.client_epoch!=42 OR NOT EXISTS(
 SELECT 1 FROM rule_csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,13) AND status='complete'))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER rule_csv_complete BEFORE UPDATE OF status ON rule_csv_imports
WHEN NEW.status='complete' AND (OLD.status!='ready' OR NEW.completed_at IS NULL OR NEW.total<1
 OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='rule-csv:'||NEW.id AND client_epoch=42))
BEGIN SELECT RAISE(ABORT,'rule_csv_completion_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER rule_csv_reset BEFORE UPDATE OF status ON rule_csv_imports
WHEN OLD.status='complete' AND NEW.status='ready' AND (NEW.completed_at IS NOT NULL OR NEW.created+NEW.updated+NEW.total+NEW.disabled!=0
 OR NEW.last_revert_receipt IS NULL OR NEW.last_revert_receipt IS OLD.last_revert_receipt
 OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='rule-revert:'||NEW.id AND client_epoch=42))
BEGIN SELECT RAISE(ABORT,'rule_csv_reset_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER rule_csv_transition BEFORE UPDATE OF status ON rule_csv_imports
WHEN NEW.status!=OLD.status AND NOT (NEW.status='deleting' OR OLD.status='uploading' AND NEW.status='ready'
 OR OLD.status='ready' AND NEW.status='complete' OR OLD.status='complete' AND NEW.status='ready')
BEGIN SELECT RAISE(ABORT,'rule_csv_transition_invalid'); END;

