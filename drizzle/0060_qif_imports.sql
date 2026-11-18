CREATE TABLE `qif_import_accounts` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `qif_imports`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qif_accounts_owner_record` ON `qif_import_accounts` (`owner_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `qif_accounts_owner_source` ON `qif_import_accounts` (`owner_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `qif_import_commits` (
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`source_id` text NOT NULL,
	`filename` text NOT NULL,
	`source_sha256` text NOT NULL,
	`input_hash` text NOT NULL,
	`receipt` text NOT NULL,
	`committed_at` text NOT NULL,
	`summary_json` text NOT NULL,
	`configuration_revision` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "qif_commit_hashes" CHECK(length("qif_import_commits"."source_sha256")=64 AND "qif_import_commits"."source_sha256" NOT GLOB '*[^a-f0-9]*' AND length("qif_import_commits"."input_hash")=64 AND "qif_import_commits"."input_hash" NOT GLOB '*[^a-f0-9]*' AND length("qif_import_commits"."receipt")=64 AND "qif_import_commits"."receipt" NOT GLOB '*[^a-f0-9]*'),
	CONSTRAINT "qif_commit_summary" CHECK(json_valid("qif_import_commits"."summary_json") AND json_type("qif_import_commits"."summary_json")='object' AND length("qif_import_commits"."summary_json")<=4000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qif_commit_owner_request` ON `qif_import_commits` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `qif_import_trades` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`trade_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `qif_imports`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`trade_id`) REFERENCES `trades`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qif_trades_owner_record` ON `qif_import_trades` (`owner_id`,`trade_id`);--> statement-breakpoint
CREATE INDEX `qif_trades_owner_source` ON `qif_import_trades` (`owner_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `qif_import_transactions` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `qif_imports`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qif_transactions_owner_record` ON `qif_import_transactions` (`owner_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `qif_transactions_owner_source` ON `qif_import_transactions` (`owner_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `qif_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`active_request_id` text,
	`filename` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`content_sha256` text,
	`encoding` text,
	`storage_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`configuration_json` text,
	`input_hash` text,
	`configuration_revision` integer DEFAULT 0 NOT NULL,
	`ownership_counts_json` text,
	`reverted_at` text,
	`last_revert_receipt` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "qif_bytes" CHECK("qif_imports"."byte_size" BETWEEN 1 AND 8000000),
	CONSTRAINT "qif_active" CHECK("qif_imports"."active_request_id" IS NULL OR (length("qif_imports"."active_request_id")=36 AND "qif_imports"."active_request_id"!="qif_imports"."request_id")),
	CONSTRAINT "qif_sha" CHECK(length("qif_imports"."sha256")=64 AND "qif_imports"."sha256" NOT GLOB '*[^a-f0-9]*' AND ("qif_imports"."content_sha256" IS NULL OR (length("qif_imports"."content_sha256")=64 AND "qif_imports"."content_sha256" NOT GLOB '*[^a-f0-9]*')) AND ("qif_imports"."input_hash" IS NULL OR (length("qif_imports"."input_hash")=64 AND "qif_imports"."input_hash" NOT GLOB '*[^a-f0-9]*'))),
	CONSTRAINT "qif_configuration" CHECK(("qif_imports"."configuration_json" IS NULL AND "qif_imports"."input_hash" IS NULL) OR ("qif_imports"."configuration_json" IS NOT NULL AND "qif_imports"."input_hash" IS NOT NULL AND json_valid("qif_imports"."configuration_json") AND json_type("qif_imports"."configuration_json")='object' AND length("qif_imports"."configuration_json")<=1000000)),
	CONSTRAINT "qif_revision" CHECK("qif_imports"."configuration_revision" BETWEEN 0 AND 2147483647),
	CONSTRAINT "qif_reverted" CHECK(("qif_imports"."reverted_at" IS NULL AND "qif_imports"."last_revert_receipt" IS NULL) OR ("qif_imports"."reverted_at" IS NOT NULL AND length("qif_imports"."last_revert_receipt")=64 AND "qif_imports"."last_revert_receipt" NOT GLOB '*[^a-f0-9]*')),
	CONSTRAINT "qif_counts" CHECK("qif_imports"."ownership_counts_json" IS NULL OR COALESCE(json_valid("qif_imports"."ownership_counts_json") AND json_type("qif_imports"."ownership_counts_json")='object' AND length("qif_imports"."ownership_counts_json")<=200 AND json_type("qif_imports"."ownership_counts_json",'$.accounts')='integer' AND json_extract("qif_imports"."ownership_counts_json",'$.accounts') BETWEEN 0 AND 500 AND json_type("qif_imports"."ownership_counts_json",'$.transactions')='integer' AND json_extract("qif_imports"."ownership_counts_json",'$.transactions') BETWEEN 0 AND 20000 AND json_type("qif_imports"."ownership_counts_json",'$.trades')='integer' AND json_extract("qif_imports"."ownership_counts_json",'$.trades') BETWEEN 0 AND 20000,0)),
	CONSTRAINT "qif_status" CHECK("qif_imports"."status" IN ('uploading','ready','complete','deleting') AND ("qif_imports"."status" NOT IN ('ready','complete') OR ("qif_imports"."content_sha256" IS NOT NULL AND "qif_imports"."encoding" IN ('UTF-8','Windows-1252','Windows-1250','Windows-1252 (undefined bytes omitted)'))) AND ("qif_imports"."status"!='complete' OR ("qif_imports"."completed_at" IS NOT NULL AND "qif_imports"."configuration_json" IS NOT NULL AND "qif_imports"."ownership_counts_json" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `qif_owner_id` ON `qif_imports` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `qif_owner_request` ON `qif_imports` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `qif_owner_active` ON `qif_imports` (`owner_id`,`active_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `qif_storage` ON `qif_imports` (`storage_key`);--> statement-breakpoint
CREATE INDEX `qif_owner_created` ON `qif_imports` (`owner_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER qif_source_limit BEFORE INSERT ON qif_imports WHEN (SELECT count(*) FROM qif_imports WHERE owner_id=NEW.owner_id)>=10 BEGIN SELECT RAISE(ABORT,'qif_source_limit'); END;
--> statement-breakpoint
CREATE TRIGGER qif_source_identity BEFORE UPDATE ON qif_imports WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.request_id IS NOT OLD.request_id OR NEW.filename IS NOT OLD.filename OR NEW.byte_size IS NOT OLD.byte_size OR NEW.sha256 IS NOT OLD.sha256 OR NEW.storage_key IS NOT OLD.storage_key OR NEW.created_at IS NOT OLD.created_at OR (OLD.content_sha256 IS NOT NULL AND (NEW.content_sha256 IS NOT OLD.content_sha256 OR NEW.encoding IS NOT OLD.encoding)) BEGIN SELECT RAISE(ABORT,'qif_source_identity'); END;
--> statement-breakpoint
CREATE TRIGGER qif_source_namespace BEFORE INSERT ON qif_imports WHEN EXISTS(SELECT 1 FROM qif_imports WHERE owner_id=NEW.owner_id AND active_request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM qif_import_commits WHERE owner_id=NEW.owner_id AND request_id=NEW.request_id) BEGIN SELECT RAISE(ABORT,'qif_request_used'); END;
--> statement-breakpoint
CREATE TRIGGER qif_source_active_namespace BEFORE UPDATE OF active_request_id ON qif_imports WHEN NEW.active_request_id IS NOT OLD.active_request_id AND (EXISTS(SELECT 1 FROM qif_imports WHERE owner_id=NEW.owner_id AND id!=NEW.id AND (request_id=NEW.active_request_id OR active_request_id=NEW.active_request_id)) OR EXISTS(SELECT 1 FROM qif_import_commits WHERE owner_id=NEW.owner_id AND request_id=NEW.active_request_id)) BEGIN SELECT RAISE(ABORT,'qif_request_used'); END;
--> statement-breakpoint
CREATE TRIGGER qif_source_config BEFORE UPDATE ON qif_imports WHEN (NEW.configuration_json IS NOT OLD.configuration_json OR NEW.input_hash IS NOT OLD.input_hash) AND (OLD.status!='ready' OR NEW.status!='ready' OR NEW.configuration_revision!=OLD.configuration_revision+1 OR NEW.active_request_id IS NOT OLD.active_request_id) BEGIN SELECT RAISE(ABORT,'qif_choices_changed'); END;
--> statement-breakpoint
CREATE TRIGGER qif_source_revision BEFORE UPDATE ON qif_imports WHEN NEW.configuration_revision IS NOT OLD.configuration_revision AND NOT ((NEW.configuration_json IS NOT OLD.configuration_json OR NEW.input_hash IS NOT OLD.input_hash) AND NEW.configuration_revision=OLD.configuration_revision+1 AND OLD.status='ready' AND NEW.status='ready') AND NOT (OLD.status='complete' AND NEW.status='ready' AND NEW.configuration_revision=OLD.configuration_revision+1 AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='qif-revert:'||NEW.id AND client_epoch=38)) BEGIN SELECT RAISE(ABORT,'qif_revision_changed'); END;
--> statement-breakpoint
CREATE TRIGGER qif_source_active_guard BEFORE UPDATE OF active_request_id ON qif_imports WHEN NEW.active_request_id IS NOT OLD.active_request_id AND NOT (OLD.status='complete' AND NEW.status='ready' AND NEW.active_request_id IS NOT NULL AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='qif-revert:'||NEW.id AND client_epoch=38)) BEGIN SELECT RAISE(ABORT,'qif_cycle_guard'); END;
--> statement-breakpoint
CREATE TRIGGER qif_source_revert BEFORE UPDATE OF status ON qif_imports WHEN OLD.status='complete' AND NEW.status='ready' AND (NEW.completed_at IS NOT NULL OR NEW.ownership_counts_json IS NOT NULL OR NEW.last_revert_receipt IS NULL OR NEW.last_revert_receipt IS OLD.last_revert_receipt OR NEW.active_request_id IS OLD.active_request_id OR NEW.configuration_revision!=OLD.configuration_revision+1 OR EXISTS(SELECT 1 FROM qif_import_accounts WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR EXISTS(SELECT 1 FROM qif_import_transactions WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR EXISTS(SELECT 1 FROM qif_import_trades WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='qif-revert:'||NEW.id AND client_epoch=38)) BEGIN SELECT RAISE(ABORT,'qif_revert_guard'); END;
--> statement-breakpoint
CREATE TRIGGER qif_marker_update BEFORE UPDATE ON qif_import_commits BEGIN SELECT RAISE(ABORT,'qif_receipt_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER qif_marker_delete BEFORE DELETE ON qif_import_commits BEGIN SELECT RAISE(ABORT,'qif_receipt_permanent'); END;
--> statement-breakpoint
CREATE TRIGGER qif_marker_guard BEFORE INSERT ON qif_import_commits WHEN NOT EXISTS(SELECT 1 FROM qif_imports s JOIN workspace_guards g ON g.owner_id=s.owner_id AND g.client_epoch=37 AND substr(g.id,1,21)='category-restore:qif:' AND substr(g.id,-36)=NEW.request_id WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id AND COALESCE(s.active_request_id,s.request_id)=NEW.request_id AND s.status='ready' AND s.input_hash=NEW.input_hash AND s.sha256=NEW.source_sha256 AND s.configuration_revision=NEW.configuration_revision) BEGIN SELECT RAISE(ABORT,'qif_marker_guard'); END;
--> statement-breakpoint
CREATE TRIGGER qif_complete_guard BEFORE UPDATE OF status ON qif_imports WHEN NEW.status='complete' AND OLD.status!='complete' AND (OLD.status!='ready' OR NOT EXISTS(SELECT 1 FROM qif_import_commits WHERE owner_id=NEW.owner_id AND source_id=NEW.id AND request_id=COALESCE(NEW.active_request_id,NEW.request_id) AND input_hash=NEW.input_hash AND source_sha256=NEW.sha256 AND configuration_revision=NEW.configuration_revision AND committed_at=NEW.completed_at) OR json_extract(NEW.ownership_counts_json,'$.accounts')!=(SELECT count(*) FROM qif_import_accounts WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR json_extract(NEW.ownership_counts_json,'$.transactions')!=(SELECT count(*) FROM qif_import_transactions WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR json_extract(NEW.ownership_counts_json,'$.trades')!=(SELECT count(*) FROM qif_import_trades WHERE owner_id=NEW.owner_id AND source_id=NEW.id)) BEGIN SELECT RAISE(ABORT,'qif_complete_guard'); END;
--> statement-breakpoint
CREATE TRIGGER qif_claim_accounts BEFORE INSERT ON qif_import_accounts WHEN NOT EXISTS(SELECT 1 FROM qif_imports s JOIN workspace_guards g ON g.owner_id=s.owner_id AND g.client_epoch=37 AND substr(g.id,1,21)='category-restore:qif:' AND substr(g.id,-36)=COALESCE(s.active_request_id,s.request_id) WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id AND s.status='ready') BEGIN SELECT RAISE(ABORT,'qif_claim_guard'); END;
--> statement-breakpoint
CREATE TRIGGER qif_claim_transactions BEFORE INSERT ON qif_import_transactions WHEN NOT EXISTS(SELECT 1 FROM qif_imports s JOIN workspace_guards g ON g.owner_id=s.owner_id AND g.client_epoch=37 AND substr(g.id,1,21)='category-restore:qif:' AND substr(g.id,-36)=COALESCE(s.active_request_id,s.request_id) WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id AND s.status='ready') BEGIN SELECT RAISE(ABORT,'qif_claim_guard'); END;
--> statement-breakpoint
CREATE TRIGGER qif_claim_trades BEFORE INSERT ON qif_import_trades WHEN NOT EXISTS(SELECT 1 FROM qif_imports s JOIN workspace_guards g ON g.owner_id=s.owner_id AND g.client_epoch=37 AND substr(g.id,1,21)='category-restore:qif:' AND substr(g.id,-36)=COALESCE(s.active_request_id,s.request_id) WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id AND s.status='ready') BEGIN SELECT RAISE(ABORT,'qif_claim_guard'); END;
--> statement-breakpoint
CREATE TRIGGER qif_source_status_transition BEFORE UPDATE OF status ON qif_imports WHEN NEW.status!=OLD.status AND NOT ((OLD.status='uploading' AND NEW.status IN ('ready','deleting')) OR (OLD.status='ready' AND NEW.status IN ('complete','deleting')) OR (OLD.status='complete' AND NEW.status IN ('ready','deleting'))) BEGIN SELECT RAISE(ABORT,'qif_status_transition'); END;
--> statement-breakpoint
CREATE TRIGGER qif_claim_accounts_update BEFORE UPDATE ON qif_import_accounts BEGIN SELECT RAISE(ABORT,'qif_claim_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER qif_claim_transactions_update BEFORE UPDATE ON qif_import_transactions BEGIN SELECT RAISE(ABORT,'qif_claim_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER qif_claim_trades_update BEFORE UPDATE ON qif_import_trades BEGIN SELECT RAISE(ABORT,'qif_claim_immutable'); END;
