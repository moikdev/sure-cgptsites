ALTER TABLE `split_lines` ADD `reconciliation_json` text;
--> statement-breakpoint
CREATE TRIGGER split_reconciliation_insert BEFORE INSERT ON split_lines
WHEN NEW.reconciliation_json IS NOT NULL AND CASE
 WHEN NOT json_valid(NEW.reconciliation_json) THEN 1
 WHEN json_type(NEW.reconciliation_json) IS NOT 'object' THEN 1
 WHEN (SELECT count(*) FROM json_each(NEW.reconciliation_json)) != 2 THEN 1
 WHEN json_type(NEW.reconciliation_json,'$.status') IS NOT 'text' THEN 1
 WHEN json_extract(NEW.reconciliation_json,'$.status')='reconciled' THEN
  json_type(NEW.reconciliation_json,'$.at') IS NOT 'text' OR
  strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(NEW.reconciliation_json,'$.at')) IS NOT json_extract(NEW.reconciliation_json,'$.at')
 ELSE json_extract(NEW.reconciliation_json,'$.status') NOT IN ('cleared','unreconciled') OR json_type(NEW.reconciliation_json,'$.at') IS NOT 'null'
 END
BEGIN SELECT RAISE(ABORT,'invalid_split_reconciliation'); END;
--> statement-breakpoint
CREATE TRIGGER split_reconciliation_update BEFORE UPDATE OF reconciliation_json ON split_lines
WHEN NEW.reconciliation_json IS NOT NULL AND CASE
 WHEN NOT json_valid(NEW.reconciliation_json) THEN 1
 WHEN json_type(NEW.reconciliation_json) IS NOT 'object' THEN 1
 WHEN (SELECT count(*) FROM json_each(NEW.reconciliation_json)) != 2 THEN 1
 WHEN json_type(NEW.reconciliation_json,'$.status') IS NOT 'text' THEN 1
 WHEN json_extract(NEW.reconciliation_json,'$.status')='reconciled' THEN
  json_type(NEW.reconciliation_json,'$.at') IS NOT 'text' OR
  strftime('%Y-%m-%dT%H:%M:%fZ',json_extract(NEW.reconciliation_json,'$.at')) IS NOT json_extract(NEW.reconciliation_json,'$.at')
 ELSE json_extract(NEW.reconciliation_json,'$.status') NOT IN ('cleared','unreconciled') OR json_type(NEW.reconciliation_json,'$.at') IS NOT 'null'
 END
BEGIN SELECT RAISE(ABORT,'invalid_split_reconciliation'); END;
--> statement-breakpoint
CREATE TRIGGER split_reconciliation_legacy_restore BEFORE DELETE ON split_lines
WHEN OLD.reconciliation_json IS NOT NULL AND EXISTS (
 SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id
 AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)
 AND id NOT GLOB 'category-restore:split-v36:*'
)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
