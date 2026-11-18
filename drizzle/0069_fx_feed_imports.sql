CREATE TABLE fx_feed_imports (
 id TEXT PRIMARY KEY NOT NULL,owner_id TEXT NOT NULL REFERENCES profiles(owner_id),request_id TEXT NOT NULL,
 options_json TEXT NOT NULL,storage_key TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,
 source_sha256 TEXT,source_bytes INTEGER,last_error TEXT,completed_at TEXT,commit_receipt TEXT,completion_json TEXT,
 CONSTRAINT fx_feed_options CHECK(json_valid(options_json) AND json_type(options_json)='object' AND length(options_json)<=1000),
 CONSTRAINT fx_feed_source CHECK((source_sha256 IS NULL AND source_bytes IS NULL) OR coalesce(length(source_sha256)=64 AND source_sha256 NOT GLOB '*[^a-f0-9]*' AND source_bytes BETWEEN 2 AND 5242880,0)),
 CONSTRAINT fx_feed_status CHECK(status IN ('pending','ready','complete','deleting') AND (status NOT IN ('ready','complete') OR source_sha256 IS NOT NULL)),
 CONSTRAINT fx_feed_completion CHECK((completed_at IS NULL AND commit_receipt IS NULL AND completion_json IS NULL) OR coalesce(completed_at IS NOT NULL AND length(commit_receipt)=64 AND commit_receipt NOT GLOB '*[^a-f0-9]*' AND json_valid(completion_json) AND json_type(completion_json)='object' AND length(completion_json)<=4000,0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX fx_feed_owner_request ON fx_feed_imports(owner_id,request_id);
--> statement-breakpoint
CREATE UNIQUE INDEX fx_feed_storage ON fx_feed_imports(storage_key);
--> statement-breakpoint
CREATE INDEX fx_feed_owner_created ON fx_feed_imports(owner_id,created_at);
--> statement-breakpoint
CREATE TRIGGER fx_feed_limit BEFORE INSERT ON fx_feed_imports WHEN (SELECT count(*) FROM fx_feed_imports WHERE owner_id=NEW.owner_id)>=10
BEGIN SELECT RAISE(ABORT,'fx_feed_limit'); END;
--> statement-breakpoint
CREATE TRIGGER fx_feed_initial BEFORE INSERT ON fx_feed_imports
WHEN NEW.status!='pending' OR NEW.source_sha256 IS NOT NULL OR NEW.source_bytes IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.commit_receipt IS NOT NULL OR NEW.completion_json IS NOT NULL
BEGIN SELECT RAISE(ABORT,'fx_feed_initial'); END;
--> statement-breakpoint
CREATE TRIGGER fx_feed_immutable BEFORE UPDATE ON fx_feed_imports
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.request_id IS NOT OLD.request_id OR NEW.options_json IS NOT OLD.options_json OR NEW.storage_key IS NOT OLD.storage_key OR NEW.created_at IS NOT OLD.created_at
 OR OLD.source_sha256 IS NOT NULL AND (NEW.source_sha256 IS NOT OLD.source_sha256 OR NEW.source_bytes IS NOT OLD.source_bytes)
 OR OLD.completed_at IS NOT NULL AND (NEW.completed_at IS NOT OLD.completed_at OR NEW.commit_receipt IS NOT OLD.commit_receipt OR NEW.completion_json IS NOT OLD.completion_json)
BEGIN SELECT RAISE(ABORT,'fx_feed_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER fx_feed_transition BEFORE UPDATE OF status ON fx_feed_imports
WHEN NEW.status!=OLD.status AND NOT (NEW.status='deleting' OR OLD.status='pending' AND NEW.status='ready' OR OLD.status='ready' AND NEW.status='complete')
BEGIN SELECT RAISE(ABORT,'fx_feed_transition'); END;
--> statement-breakpoint
CREATE TRIGGER fx_feed_commit_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,8)='fx-feed:' AND (NEW.client_epoch!=6 OR NOT EXISTS(SELECT 1 FROM fx_feed_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,9) AND status='ready'))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER fx_feed_complete BEFORE UPDATE ON fx_feed_imports
WHEN (NEW.status='complete' AND OLD.status!='complete' OR NEW.completed_at IS NOT OLD.completed_at OR NEW.commit_receipt IS NOT OLD.commit_receipt OR NEW.completion_json IS NOT OLD.completion_json)
 AND (OLD.status!='ready' OR NEW.status!='complete' OR NEW.completed_at IS NULL OR NEW.commit_receipt IS NULL OR NEW.completion_json IS NULL
 OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='fx-feed:'||NEW.id AND client_epoch=6))
BEGIN SELECT RAISE(ABORT,'fx_feed_completion_invalid'); END;
