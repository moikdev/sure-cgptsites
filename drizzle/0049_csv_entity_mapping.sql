-- Keep the existing import/ownership graph and all prior financial rows in place.
ALTER TABLE csv_imports ADD COLUMN entity_digest text CONSTRAINT csv_entity_digest CHECK(entity_digest IS NULL OR (length(entity_digest)=64 AND entity_digest NOT GLOB '*[^a-f0-9]*'));
--> statement-breakpoint
ALTER TABLE csv_imports ADD COLUMN entity_counts text CONSTRAINT csv_entity_counts CHECK((entity_counts IS NULL AND entity_digest IS NULL) OR (entity_counts IS NOT NULL AND entity_digest IS NOT NULL AND json_valid(entity_counts) AND length(entity_counts)<=100));
--> statement-breakpoint
ALTER TABLE csv_imports ADD COLUMN updated_existing integer NOT NULL DEFAULT 0 CONSTRAINT csv_existing_update_count CHECK(updated_existing BETWEEN 0 AND 10000);
--> statement-breakpoint
CREATE TABLE `csv_import_entity_mappings` (
	`owner_id` text NOT NULL,
	`import_id` text NOT NULL,
	`kind` text NOT NULL,
	`source_name` text NOT NULL,
	`choice_json` text NOT NULL,
	FOREIGN KEY (`owner_id`,`import_id`) REFERENCES `csv_imports`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "csv_entity_mapping_kind" CHECK("csv_import_entity_mappings"."kind" IN ('categories','tags')),
	CONSTRAINT "csv_entity_mapping_choice" CHECK(json_valid("csv_import_entity_mappings"."choice_json") AND length("csv_import_entity_mappings"."choice_json")<=5000 AND length("csv_import_entity_mappings"."source_name")<=255 AND json_type("csv_import_entity_mappings"."choice_json")='object' AND json_extract("csv_import_entity_mappings"."choice_json",'$.sourceName') IS "csv_import_entity_mappings"."source_name" AND COALESCE(json_extract("csv_import_entity_mappings"."choice_json",'$.mode') IN ('existing','create','skip'),0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `csv_entity_mapping_unique` ON `csv_import_entity_mappings` (`owner_id`,`import_id`,`kind`,`source_name`);--> statement-breakpoint

CREATE TRIGGER csv_entity_meta_immutable BEFORE UPDATE OF entity_digest,entity_counts ON csv_imports
WHEN NEW.entity_digest IS NOT OLD.entity_digest OR NEW.entity_counts IS NOT OLD.entity_counts
BEGIN SELECT RAISE(ABORT,'csv_mapping_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER csv_entity_mapping_immutable BEFORE UPDATE ON csv_import_entity_mappings
BEGIN SELECT RAISE(ABORT,'csv_mapping_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER csv_entity_mapping_insert BEFORE INSERT ON csv_import_entity_mappings
WHEN NOT EXISTS(SELECT 1 FROM csv_imports WHERE owner_id=NEW.owner_id AND id=NEW.import_id AND status='uploading' AND entity_digest IS NOT NULL)
OR (json_extract(NEW.choice_json,'$.mode')='existing' AND (
 (NEW.kind='categories' AND NOT EXISTS(SELECT 1 FROM categories WHERE owner_id=NEW.owner_id AND id=json_extract(NEW.choice_json,'$.targetId'))) OR
 (NEW.kind='tags' AND NOT EXISTS(SELECT 1 FROM tags WHERE owner_id=NEW.owner_id AND id=json_extract(NEW.choice_json,'$.targetId')))))
BEGIN SELECT RAISE(ABORT,'csv_entity_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER csv_entity_mapping_limit BEFORE INSERT ON csv_import_entity_mappings
WHEN (SELECT count(*) FROM csv_import_entity_mappings WHERE owner_id=NEW.owner_id AND import_id=NEW.import_id AND kind=NEW.kind)>=2000
BEGIN SELECT RAISE(ABORT,'csv_entity_mapping_limit'); END;
--> statement-breakpoint
CREATE TRIGGER csv_entity_commit_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,4)='csv:' AND NEW.client_epoch!=40 AND EXISTS(SELECT 1 FROM csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,5) AND entity_digest IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER csv_entity_reset BEFORE UPDATE OF status ON csv_imports
WHEN OLD.status='complete' AND NEW.status='ready' AND NEW.updated_existing!=0
BEGIN SELECT RAISE(ABORT,'csv_entity_reset_required'); END;
--> statement-breakpoint
DROP TRIGGER csv_created_account_claim;
--> statement-breakpoint
CREATE TRIGGER csv_created_account_claim BEFORE INSERT ON csv_import_accounts
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards g WHERE g.owner_id=NEW.owner_id AND g.id='csv:'||NEW.import_id AND g.client_epoch IN (38,40))
OR NOT EXISTS(SELECT 1 FROM csv_imports i,json_each(i.account_creations) c WHERE i.owner_id=NEW.owner_id AND i.id=NEW.import_id AND i.status='ready' AND json_extract(c.value,'$.id')=NEW.proposal_id)
BEGIN SELECT RAISE(ABORT,'csv_account_claim_invalid'); END;
