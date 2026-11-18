ALTER TABLE `goal_consumptions` ADD `conversion` text;--> statement-breakpoint
ALTER TABLE `goal_pledges` ADD `matched_conversion` text;
--> statement-breakpoint
DROP TRIGGER protect_goal_consumption_transaction;
--> statement-breakpoint
CREATE TRIGGER protect_goal_consumption_transaction BEFORE UPDATE OF amount,account_id,date,excluded,transfer_id ON transactions
WHEN EXISTS (SELECT 1 FROM goal_consumptions c WHERE c.owner_id=OLD.owner_id AND c.transaction_id=OLD.id
 AND (NEW.amount>=0 OR -NEW.amount<COALESCE(json_extract(c.conversion,'$.nativeAmount'),c.amount) OR NEW.account_id IS NOT c.account_id OR NEW.date IS NOT c.date OR NEW.excluded!=0 OR NEW.transfer_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
DROP TRIGGER cancel_incompatible_account_pledges;
--> statement-breakpoint
CREATE TRIGGER cancel_incompatible_account_pledges AFTER UPDATE OF type,currency ON accounts
BEGIN UPDATE goal_pledges SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND status='open' AND (NEW.currency IS NOT OLD.currency OR NEW.type NOT IN ('checking','savings','investment','crypto') OR (kind='manual_save' AND NEW.type NOT IN ('checking','savings'))); END;
--> statement-breakpoint
CREATE TRIGGER protect_goal_history_account_currency BEFORE UPDATE OF currency ON accounts
WHEN NEW.currency IS NOT OLD.currency AND (EXISTS (SELECT 1 FROM goal_consumptions WHERE owner_id=OLD.owner_id AND account_id=OLD.id) OR EXISTS (SELECT 1 FROM goal_pledges WHERE owner_id=OLD.owner_id AND account_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER protect_goal_usage_opening_date BEFORE UPDATE OF opening_date ON accounts
WHEN EXISTS (SELECT 1 FROM goal_consumptions WHERE owner_id=OLD.owner_id AND account_id=OLD.id AND date<NEW.opening_date)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
