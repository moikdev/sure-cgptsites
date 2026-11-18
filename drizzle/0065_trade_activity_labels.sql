-- No row/column changes. Source activity labels are independent of quantity/cash.
-- Old investment editors (epoch 6) recalculate cash from an unknown label; protect
-- these new records while retaining their harmless name/note-only updates.
CREATE TRIGGER trade_activity_old_insert BEFORE INSERT ON trades
WHEN NEW.activity IN ('contribution','withdrawal','exchange','other') AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=8)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER trade_activity_old_update BEFORE UPDATE ON trades
WHEN (OLD.activity IN ('contribution','withdrawal','exchange','other') OR NEW.activity IN ('contribution','withdrawal','exchange','other'))
AND (NEW.account_id IS NOT OLD.account_id OR NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.fee IS NOT OLD.fee OR NEW.cash_amount IS NOT OLD.cash_amount OR NEW.currency IS NOT OLD.currency OR NEW.activity IS NOT OLD.activity OR NEW.sequence IS NOT OLD.sequence OR NEW.conversion IS NOT OLD.conversion)
AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=8)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER trade_activity_old_delete BEFORE DELETE ON trades
WHEN OLD.activity IN ('contribution','withdrawal','exchange','other') AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=8)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;

--> statement-breakpoint
DROP TRIGGER trade_csv_guard;
--> statement-breakpoint
CREATE TRIGGER trade_csv_guard BEFORE INSERT ON workspace_guards WHEN substr(NEW.id,1,10)='trade-csv:' AND (NEW.client_epoch NOT IN (6,8) OR NOT EXISTS(SELECT 1 FROM trade_csv_imports WHERE owner_id=NEW.owner_id AND id=substr(NEW.id,11) AND status='ready')) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;

--> statement-breakpoint
DROP TRIGGER trade_csv_entry_claim;
--> statement-breakpoint
CREATE TRIGGER trade_csv_entry_claim BEFORE INSERT ON trade_csv_entries WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='trade-csv:'||NEW.import_id AND client_epoch IN (6,8)) OR NOT EXISTS(SELECT 1 FROM trade_csv_imports WHERE owner_id=NEW.owner_id AND id=NEW.import_id AND status='ready') BEGIN SELECT RAISE(ABORT,'trade_csv_claim_invalid'); END;

--> statement-breakpoint
DROP TRIGGER trade_csv_account_claim;
--> statement-breakpoint
CREATE TRIGGER trade_csv_account_claim BEFORE INSERT ON trade_csv_accounts WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='trade-csv:'||NEW.import_id AND client_epoch IN (6,8)) OR NOT EXISTS(SELECT 1 FROM trade_csv_imports WHERE owner_id=NEW.owner_id AND id=NEW.import_id AND status='ready') BEGIN SELECT RAISE(ABORT,'trade_csv_claim_invalid'); END;

--> statement-breakpoint
DROP TRIGGER trade_csv_complete;
--> statement-breakpoint
CREATE TRIGGER trade_csv_complete BEFORE UPDATE OF status,imported,skipped,created_accounts ON trade_csv_imports
WHEN NEW.status='complete' AND (OLD.status!='ready' OR NEW.completed_at IS NULL OR NEW.imported+NEW.skipped NOT BETWEEN 1 AND 10000 OR NEW.imported!=(SELECT count(*) FROM trade_csv_entries WHERE owner_id=NEW.owner_id AND import_id=NEW.id) OR NEW.created_accounts!=(SELECT count(*) FROM trade_csv_accounts WHERE owner_id=NEW.owner_id AND import_id=NEW.id) OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id='trade-csv:'||NEW.id AND client_epoch IN (6,8))) BEGIN SELECT RAISE(ABORT,'trade_csv_completion_invalid'); END;

--> statement-breakpoint
DROP TRIGGER investment_csv_template_insert;
--> statement-breakpoint
CREATE TRIGGER investment_csv_template_insert BEFORE INSERT ON investment_csv_templates
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (6,8))
 OR (NEW.kind!='prices' AND NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND type IN ('investment','crypto') AND archived=0))
BEGIN SELECT RAISE(ABORT,'investment_csv_template_invalid'); END;

--> statement-breakpoint
DROP TRIGGER investment_csv_template_update;
--> statement-breakpoint
CREATE TRIGGER investment_csv_template_update BEFORE UPDATE ON investment_csv_templates
WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.scope IS NOT OLD.scope OR NEW.kind IS NOT OLD.kind OR NEW.account_id IS NOT OLD.account_id
 OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (6,8))
 OR (NEW.kind!='prices' AND NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND type IN ('investment','crypto') AND archived=0))
BEGIN SELECT RAISE(ABORT,'investment_csv_template_invalid'); END;
