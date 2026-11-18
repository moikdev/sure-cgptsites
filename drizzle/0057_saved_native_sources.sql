CREATE TABLE `native_import_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`filename` text NOT NULL,
	`kind` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`content_sha256` text,
	`options_json` text NOT NULL,
	`storage_key` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`targets_json` text,
	`input_hash` text,
	`configuration_revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "native_source_bytes" CHECK("native_import_sources"."byte_size" BETWEEN 1 AND 8000000),
	CONSTRAINT "native_source_kind" CHECK("native_import_sources"."kind" IN ('ndjson','zip')),
	CONSTRAINT "native_source_sha" CHECK(length("native_import_sources"."sha256")=64 AND "native_import_sources"."sha256" NOT GLOB '*[^a-f0-9]*' AND ("native_import_sources"."content_sha256" IS NULL OR (length("native_import_sources"."content_sha256")=64 AND "native_import_sources"."content_sha256" NOT GLOB '*[^a-f0-9]*')) AND ("native_import_sources"."input_hash" IS NULL OR (length("native_import_sources"."input_hash")=64 AND "native_import_sources"."input_hash" NOT GLOB '*[^a-f0-9]*'))),
	CONSTRAINT "native_source_options" CHECK(json_valid("native_import_sources"."options_json") AND json_type("native_import_sources"."options_json")='object' AND length("native_import_sources"."options_json")<=1000),
	CONSTRAINT "native_source_targets" CHECK(("native_import_sources"."targets_json" IS NULL AND "native_import_sources"."input_hash" IS NULL) OR ("native_import_sources"."targets_json" IS NOT NULL AND "native_import_sources"."input_hash" IS NOT NULL AND json_valid("native_import_sources"."targets_json") AND json_type("native_import_sources"."targets_json")='array' AND json_array_length("native_import_sources"."targets_json")<=500 AND length("native_import_sources"."targets_json")<=500000)),
	CONSTRAINT "native_source_revision" CHECK("native_import_sources"."configuration_revision" BETWEEN 0 AND 2147483647),
	CONSTRAINT "native_source_status" CHECK("native_import_sources"."status" IN ('uploading','ready','complete','deleting') AND ("native_import_sources"."status" NOT IN ('ready','complete') OR "native_import_sources"."content_sha256" IS NOT NULL) AND ("native_import_sources"."status"!='complete' OR ("native_import_sources"."completed_at" IS NOT NULL AND "native_import_sources"."targets_json" IS NOT NULL)))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_source_owner_request` ON `native_import_sources` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `native_source_storage` ON `native_import_sources` (`storage_key`);--> statement-breakpoint
CREATE INDEX `native_source_owner_created` ON `native_import_sources` (`owner_id`,`created_at`);--> statement-breakpoint
CREATE TRIGGER native_source_quota BEFORE INSERT ON native_import_sources
WHEN NEW.status!='uploading' OR NEW.content_sha256 IS NOT NULL OR NEW.targets_json IS NOT NULL OR NEW.input_hash IS NOT NULL OR NEW.configuration_revision!=0 OR NEW.completed_at IS NOT NULL OR (SELECT count(*) FROM native_import_sources WHERE owner_id=NEW.owner_id)>=10 OR EXISTS(SELECT 1 FROM native_merge_commits WHERE owner_id=NEW.owner_id AND request_id=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'native_source_reservation_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_reservation BEFORE UPDATE ON native_import_sources
WHEN OLD.id IS NOT NEW.id OR OLD.owner_id IS NOT NEW.owner_id OR OLD.request_id IS NOT NEW.request_id OR OLD.filename IS NOT NEW.filename OR OLD.kind IS NOT NEW.kind OR OLD.byte_size IS NOT NEW.byte_size OR OLD.sha256 IS NOT NEW.sha256 OR OLD.options_json IS NOT NEW.options_json OR OLD.storage_key IS NOT NEW.storage_key OR OLD.created_at IS NOT NEW.created_at OR (OLD.content_sha256 IS NOT NULL AND OLD.content_sha256 IS NOT NEW.content_sha256)
BEGIN SELECT RAISE(ABORT,'native_source_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_transition BEFORE UPDATE ON native_import_sources
WHEN (OLD.status='uploading' AND NEW.status NOT IN ('uploading','ready','deleting')) OR (OLD.status='ready' AND NEW.status NOT IN ('ready','complete','deleting')) OR (OLD.status='complete' AND NEW.status NOT IN ('complete','deleting')) OR (OLD.status='deleting' AND NEW.status!='deleting') OR (OLD.status='complete' AND (OLD.targets_json IS NOT NEW.targets_json OR OLD.input_hash IS NOT NEW.input_hash OR OLD.completed_at IS NOT NEW.completed_at OR OLD.configuration_revision IS NOT NEW.configuration_revision))
BEGIN SELECT RAISE(ABORT,'native_source_transition_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_configuration BEFORE UPDATE ON native_import_sources
WHEN ((OLD.targets_json IS NOT NEW.targets_json OR OLD.input_hash IS NOT NEW.input_hash) AND (OLD.status!='ready' OR NEW.configuration_revision!=OLD.configuration_revision+1 OR (NEW.status!='complete' AND EXISTS(SELECT 1 FROM native_merge_commits WHERE owner_id=OLD.owner_id AND request_id=OLD.request_id)))) OR ((OLD.targets_json IS NEW.targets_json AND OLD.input_hash IS NEW.input_hash) AND OLD.configuration_revision!=NEW.configuration_revision)
BEGIN SELECT RAISE(ABORT,'native_source_configuration_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_completion BEFORE UPDATE ON native_import_sources
WHEN NEW.status='complete' AND (NEW.completed_at IS NULL OR NOT EXISTS(SELECT 1 FROM native_merge_commits WHERE owner_id=NEW.owner_id AND request_id=NEW.request_id AND input_hash=NEW.input_hash AND source_sha256=NEW.content_sha256 AND targets_json=NEW.targets_json AND committed_at=NEW.completed_at))
BEGIN SELECT RAISE(ABORT,'native_source_completion_invalid'); END;

--> statement-breakpoint
CREATE TRIGGER native_source_delete BEFORE DELETE ON native_import_sources
WHEN OLD.status!='deleting'
BEGIN SELECT RAISE(ABORT,'native_source_delete_invalid'); END;
