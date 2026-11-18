-- Preserve staged sources, ownership history and all existing guards in place.
ALTER TABLE csv_imports ADD COLUMN account_mappings text CONSTRAINT csv_account_mappings CHECK(account_mappings IS NULL OR (json_valid(account_mappings) AND json_type(account_mappings)='array' AND json_array_length(account_mappings) BETWEEN 1 AND 500 AND length(account_mappings)<=200000));
--> statement-breakpoint
CREATE TRIGGER csv_mapped_accounts BEFORE INSERT ON csv_imports
WHEN NEW.account_mappings IS NOT NULL AND EXISTS (
 SELECT 1 FROM json_each(NEW.account_mappings) m WHERE NOT EXISTS (
 SELECT 1 FROM accounts a WHERE a.owner_id=NEW.owner_id AND a.id=json_extract(m.value,'$.accountId') AND a.archived=0))
BEGIN SELECT RAISE(ABORT,'csv_account_unavailable'); END;
--> statement-breakpoint
CREATE TRIGGER csv_mapping_immutable BEFORE UPDATE OF account_mappings ON csv_imports
WHEN NEW.account_mappings IS NOT OLD.account_mappings
BEGIN SELECT RAISE(ABORT,'csv_mapping_immutable'); END;
