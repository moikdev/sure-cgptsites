CREATE TABLE `native_merge_commits` (
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`filename` text NOT NULL,
	`source_sha256` text NOT NULL,
	`input_hash` text NOT NULL,
	`receipt` text NOT NULL,
	`committed_at` text NOT NULL,
	`summary_json` text NOT NULL,
	`targets_json` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "native_merge_hashes" CHECK(length("native_merge_commits"."source_sha256")=64 AND "native_merge_commits"."source_sha256" NOT GLOB '*[^a-f0-9]*' AND length("native_merge_commits"."input_hash")=64 AND "native_merge_commits"."input_hash" NOT GLOB '*[^a-f0-9]*' AND length("native_merge_commits"."receipt")=64 AND "native_merge_commits"."receipt" NOT GLOB '*[^a-f0-9]*'),
	CONSTRAINT "native_merge_summary" CHECK(json_valid("native_merge_commits"."summary_json") AND json_type("native_merge_commits"."summary_json")='object' AND length("native_merge_commits"."summary_json")<=20000),
	CONSTRAINT "native_merge_targets" CHECK(json_valid("native_merge_commits"."targets_json") AND json_type("native_merge_commits"."targets_json")='array' AND json_array_length("native_merge_commits"."targets_json")<=500 AND length("native_merge_commits"."targets_json")<=500000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `native_merge_owner_request` ON `native_merge_commits` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE INDEX `native_merge_owner_time` ON `native_merge_commits` (`owner_id`,`committed_at`);
--> statement-breakpoint
CREATE TRIGGER native_merge_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,30)='category-restore:native-merge:' AND (NEW.client_epoch!=37 OR EXISTS(
 SELECT 1 FROM native_merge_commits WHERE owner_id=NEW.owner_id AND request_id=substr(NEW.id,-36)))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER native_merge_marker BEFORE INSERT ON native_merge_commits
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch=37
 AND substr(id,1,30)='category-restore:native-merge:' AND substr(id,-36)=NEW.request_id)
BEGIN SELECT RAISE(ABORT,'native_merge_marker_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_merge_marker_immutable BEFORE UPDATE ON native_merge_commits
BEGIN SELECT RAISE(ABORT,'native_merge_marker_immutable'); END;
