ALTER TABLE native_import_sources ADD active_request_id text CONSTRAINT "native_source_active_request" CHECK("native_import_sources"."active_request_id" IS NULL OR (length("native_import_sources"."active_request_id")=36 AND "native_import_sources"."active_request_id"!="native_import_sources"."request_id"));
--> statement-breakpoint
ALTER TABLE native_import_sources ADD reversal_tracked integer;
--> statement-breakpoint
ALTER TABLE native_import_sources ADD ownership_counts_json text CONSTRAINT "native_source_ownership_counts" CHECK(COALESCE(("native_import_sources"."reversal_tracked" IS NULL AND "native_import_sources"."ownership_counts_json" IS NULL) OR ("native_import_sources"."reversal_tracked"=1 AND "native_import_sources"."ownership_counts_json" IS NOT NULL AND json_valid("native_import_sources"."ownership_counts_json") AND json_type("native_import_sources"."ownership_counts_json")='object' AND length("native_import_sources"."ownership_counts_json")<=200 AND json_type("native_import_sources"."ownership_counts_json",'$.accounts')='integer' AND json_extract("native_import_sources"."ownership_counts_json",'$.accounts') BETWEEN 0 AND 500 AND json_type("native_import_sources"."ownership_counts_json",'$.transactions')='integer' AND json_extract("native_import_sources"."ownership_counts_json",'$.transactions') BETWEEN 0 AND 20000 AND json_type("native_import_sources"."ownership_counts_json",'$.trades')='integer' AND json_extract("native_import_sources"."ownership_counts_json",'$.trades') BETWEEN 0 AND 20000 AND json_type("native_import_sources"."ownership_counts_json",'$.valuations')='integer' AND json_extract("native_import_sources"."ownership_counts_json",'$.valuations') BETWEEN 0 AND 20000),0));
--> statement-breakpoint
ALTER TABLE native_import_sources ADD reverted_at text;
--> statement-breakpoint
ALTER TABLE native_import_sources ADD last_revert_receipt text CONSTRAINT "native_source_reversal_receipt" CHECK(("native_import_sources"."last_revert_receipt" IS NULL AND "native_import_sources"."reverted_at" IS NULL) OR ("native_import_sources"."last_revert_receipt" IS NOT NULL AND "native_import_sources"."reverted_at" IS NOT NULL AND length("native_import_sources"."last_revert_receipt")=64 AND "native_import_sources"."last_revert_receipt" NOT GLOB '*[^a-f0-9]*'));
--> statement-breakpoint
CREATE UNIQUE INDEX native_source_owner_id ON native_import_sources(owner_id,id);
--> statement-breakpoint
CREATE UNIQUE INDEX native_source_owner_active ON native_import_sources(owner_id,active_request_id);
--> statement-breakpoint
CREATE TABLE `native_source_accounts` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`account_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `native_import_sources`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_source_accounts_owner_record` ON `native_source_accounts` (`owner_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `native_source_accounts_owner_source` ON `native_source_accounts` (`owner_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `native_source_trades` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`trade_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `native_import_sources`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`trade_id`) REFERENCES `trades`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_source_trades_owner_record` ON `native_source_trades` (`owner_id`,`trade_id`);--> statement-breakpoint
CREATE INDEX `native_source_trades_owner_source` ON `native_source_trades` (`owner_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `native_source_transactions` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `native_import_sources`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_source_transactions_owner_record` ON `native_source_transactions` (`owner_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `native_source_transactions_owner_source` ON `native_source_transactions` (`owner_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `native_source_valuations` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`valuation_id` text NOT NULL,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `native_import_sources`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`valuation_id`) REFERENCES `valuations`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_source_valuations_owner_record` ON `native_source_valuations` (`owner_id`,`valuation_id`);--> statement-breakpoint
CREATE INDEX `native_source_valuations_owner_source` ON `native_source_valuations` (`owner_id`,`source_id`);--> statement-breakpoint
--> statement-breakpoint
DROP TRIGGER native_source_quota;
--> statement-breakpoint
DROP TRIGGER native_source_reservation;
--> statement-breakpoint
DROP TRIGGER native_source_transition;
--> statement-breakpoint
DROP TRIGGER native_source_configuration;
--> statement-breakpoint
DROP TRIGGER native_source_completion;
--> statement-breakpoint
DROP TRIGGER native_source_delete;
--> statement-breakpoint
CREATE TRIGGER native_source_reservation BEFORE UPDATE ON native_import_sources
WHEN OLD.id IS NOT NEW.id OR OLD.owner_id IS NOT NEW.owner_id OR OLD.request_id IS NOT NEW.request_id OR OLD.filename IS NOT NEW.filename OR OLD.kind IS NOT NEW.kind OR OLD.byte_size IS NOT NEW.byte_size OR OLD.sha256 IS NOT NEW.sha256 OR OLD.options_json IS NOT NEW.options_json OR OLD.storage_key IS NOT NEW.storage_key OR OLD.created_at IS NOT NEW.created_at OR (OLD.content_sha256 IS NOT NULL AND OLD.content_sha256 IS NOT NEW.content_sha256)
BEGIN SELECT RAISE(ABORT,'native_source_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_quota BEFORE INSERT ON native_import_sources
WHEN NEW.status!='uploading' OR NEW.active_request_id IS NOT NULL OR NEW.reversal_tracked IS NOT NULL OR NEW.ownership_counts_json IS NOT NULL OR NEW.reverted_at IS NOT NULL OR NEW.last_revert_receipt IS NOT NULL OR NEW.content_sha256 IS NOT NULL OR NEW.targets_json IS NOT NULL OR NEW.input_hash IS NOT NULL OR NEW.configuration_revision!=0 OR NEW.completed_at IS NOT NULL OR (SELECT count(*) FROM native_import_sources WHERE owner_id=NEW.owner_id)>=10 OR EXISTS(SELECT 1 FROM native_merge_commits WHERE owner_id=NEW.owner_id AND request_id=NEW.request_id) OR EXISTS(SELECT 1 FROM native_import_sources WHERE owner_id=NEW.owner_id AND COALESCE(active_request_id,request_id)=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'native_source_reservation_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_transition BEFORE UPDATE ON native_import_sources
WHEN (OLD.status='uploading' AND NEW.status NOT IN ('uploading','ready','deleting')) OR (OLD.status='ready' AND NEW.status NOT IN ('ready','complete','deleting')) OR (OLD.status='complete' AND NEW.status NOT IN ('complete','ready','deleting')) OR (OLD.status='deleting' AND NEW.status!='deleting') OR (OLD.status='complete' AND NEW.status!='ready' AND (OLD.targets_json IS NOT NEW.targets_json OR OLD.input_hash IS NOT NEW.input_hash OR OLD.completed_at IS NOT NEW.completed_at OR OLD.configuration_revision IS NOT NEW.configuration_revision))
BEGIN SELECT RAISE(ABORT,'native_source_transition_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_configuration BEFORE UPDATE ON native_import_sources
WHEN CASE WHEN OLD.status='complete' AND NEW.status='ready' THEN NEW.configuration_revision!=OLD.configuration_revision+1 OR OLD.targets_json IS NOT NEW.targets_json OR OLD.input_hash IS NOT NEW.input_hash ELSE ((OLD.targets_json IS NOT NEW.targets_json OR OLD.input_hash IS NOT NEW.input_hash) AND (OLD.status!='ready' OR NEW.configuration_revision!=OLD.configuration_revision+1 OR (NEW.status!='complete' AND EXISTS(SELECT 1 FROM native_merge_commits WHERE owner_id=OLD.owner_id AND request_id=COALESCE(OLD.active_request_id,OLD.request_id))))) OR ((OLD.targets_json IS NEW.targets_json AND OLD.input_hash IS NEW.input_hash) AND OLD.configuration_revision!=NEW.configuration_revision) END
BEGIN SELECT RAISE(ABORT,'native_source_configuration_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_completion BEFORE UPDATE ON native_import_sources
WHEN NEW.status='complete' AND (NEW.completed_at IS NULL OR NOT EXISTS(SELECT 1 FROM native_merge_commits WHERE owner_id=NEW.owner_id AND request_id=COALESCE(NEW.active_request_id,NEW.request_id) AND input_hash=NEW.input_hash AND source_sha256=NEW.content_sha256 AND targets_json=NEW.targets_json AND committed_at=NEW.completed_at) OR (OLD.status!='complete' AND ((NEW.reversal_tracked=1 AND (json_extract(NEW.ownership_counts_json,'$.accounts')!=(SELECT count(*) FROM native_source_accounts WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR json_extract(NEW.ownership_counts_json,'$.transactions')!=(SELECT count(*) FROM native_source_transactions WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR json_extract(NEW.ownership_counts_json,'$.trades')!=(SELECT count(*) FROM native_source_trades WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR json_extract(NEW.ownership_counts_json,'$.valuations')!=(SELECT count(*) FROM native_source_valuations WHERE owner_id=NEW.owner_id AND source_id=NEW.id))) OR (NEW.reversal_tracked IS NULL AND (EXISTS(SELECT 1 FROM native_source_accounts WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR EXISTS(SELECT 1 FROM native_source_transactions WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR EXISTS(SELECT 1 FROM native_source_trades WHERE owner_id=NEW.owner_id AND source_id=NEW.id) OR EXISTS(SELECT 1 FROM native_source_valuations WHERE owner_id=NEW.owner_id AND source_id=NEW.id))))))
BEGIN SELECT RAISE(ABORT,'native_source_completion_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_ownership_metadata BEFORE UPDATE ON native_import_sources
WHEN (OLD.reversal_tracked IS NOT NEW.reversal_tracked OR OLD.ownership_counts_json IS NOT NEW.ownership_counts_json) AND NOT ((OLD.status='ready' AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=37 AND substr(id,1,30)='category-restore:native-merge:' AND substr(id,-36)=COALESCE(OLD.active_request_id,OLD.request_id))) OR (OLD.status='complete' AND NEW.status='ready' AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=38 AND id='native-revert:'||OLD.id)))
BEGIN SELECT RAISE(ABORT,'native_source_ownership_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_cycle BEFORE UPDATE ON native_import_sources
WHEN (OLD.active_request_id IS NOT NEW.active_request_id OR OLD.reverted_at IS NOT NEW.reverted_at OR OLD.last_revert_receipt IS NOT NEW.last_revert_receipt) AND NOT (OLD.status='complete' AND NEW.status='ready' AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=38 AND id='native-revert:'||OLD.id))
BEGIN SELECT RAISE(ABORT,'native_source_cycle_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_reset BEFORE UPDATE ON native_import_sources
WHEN OLD.status='complete' AND NEW.status='ready' AND (OLD.reversal_tracked IS NOT 1 OR NEW.reversal_tracked IS NOT NULL OR NEW.ownership_counts_json IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.active_request_id IS NULL OR NEW.active_request_id=COALESCE(OLD.active_request_id,OLD.request_id) OR NEW.active_request_id=NEW.request_id OR NEW.reverted_at IS NULL OR NEW.last_revert_receipt IS NULL OR NEW.last_revert_receipt IS OLD.last_revert_receipt OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=38 AND id='native-revert:'||OLD.id) OR EXISTS(SELECT 1 FROM native_source_accounts WHERE owner_id=OLD.owner_id AND source_id=OLD.id) OR EXISTS(SELECT 1 FROM native_source_transactions WHERE owner_id=OLD.owner_id AND source_id=OLD.id) OR EXISTS(SELECT 1 FROM native_source_trades WHERE owner_id=OLD.owner_id AND source_id=OLD.id) OR EXISTS(SELECT 1 FROM native_source_valuations WHERE owner_id=OLD.owner_id AND source_id=OLD.id) OR EXISTS(SELECT 1 FROM native_merge_commits WHERE owner_id=NEW.owner_id AND request_id=NEW.active_request_id) OR EXISTS(SELECT 1 FROM native_import_sources WHERE owner_id=NEW.owner_id AND id!=NEW.id AND (request_id=NEW.active_request_id OR COALESCE(active_request_id,request_id)=NEW.active_request_id)))
BEGIN SELECT RAISE(ABORT,'native_source_reset_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_delete BEFORE DELETE ON native_import_sources WHEN OLD.status!='deleting'
BEGIN SELECT RAISE(ABORT,'native_source_delete_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_accounts_claim BEFORE INSERT ON native_source_accounts
WHEN NOT EXISTS(SELECT 1 FROM native_import_sources s JOIN workspace_guards g ON g.owner_id=s.owner_id WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id AND s.status='ready' AND g.client_epoch=37 AND substr(g.id,1,30)='category-restore:native-merge:' AND substr(g.id,-36)=COALESCE(s.active_request_id,s.request_id))
BEGIN SELECT RAISE(ABORT,'native_source_claim_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_accounts_immutable BEFORE UPDATE ON native_source_accounts BEGIN SELECT RAISE(ABORT,'native_source_claim_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_transactions_claim BEFORE INSERT ON native_source_transactions
WHEN NOT EXISTS(SELECT 1 FROM native_import_sources s JOIN workspace_guards g ON g.owner_id=s.owner_id WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id AND s.status='ready' AND g.client_epoch=37 AND substr(g.id,1,30)='category-restore:native-merge:' AND substr(g.id,-36)=COALESCE(s.active_request_id,s.request_id))
BEGIN SELECT RAISE(ABORT,'native_source_claim_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_transactions_immutable BEFORE UPDATE ON native_source_transactions BEGIN SELECT RAISE(ABORT,'native_source_claim_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_trades_claim BEFORE INSERT ON native_source_trades
WHEN NOT EXISTS(SELECT 1 FROM native_import_sources s JOIN workspace_guards g ON g.owner_id=s.owner_id WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id AND s.status='ready' AND g.client_epoch=37 AND substr(g.id,1,30)='category-restore:native-merge:' AND substr(g.id,-36)=COALESCE(s.active_request_id,s.request_id))
BEGIN SELECT RAISE(ABORT,'native_source_claim_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_trades_immutable BEFORE UPDATE ON native_source_trades BEGIN SELECT RAISE(ABORT,'native_source_claim_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_valuations_claim BEFORE INSERT ON native_source_valuations
WHEN NOT EXISTS(SELECT 1 FROM native_import_sources s JOIN workspace_guards g ON g.owner_id=s.owner_id WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id AND s.status='ready' AND g.client_epoch=37 AND substr(g.id,1,30)='category-restore:native-merge:' AND substr(g.id,-36)=COALESCE(s.active_request_id,s.request_id))
BEGIN SELECT RAISE(ABORT,'native_source_claim_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_valuations_immutable BEFORE UPDATE ON native_source_valuations BEGIN SELECT RAISE(ABORT,'native_source_claim_immutable'); END;
