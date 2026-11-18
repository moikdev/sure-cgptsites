ALTER TABLE `holding_snapshots` ADD `conversion` text;--> statement-breakpoint
ALTER TABLE `trades` ADD `conversion` text;
--> statement-breakpoint
CREATE TRIGGER protect_foreign_trades_update BEFORE UPDATE ON trades
WHEN OLD.conversion IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=4)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;

--> statement-breakpoint
CREATE TRIGGER protect_foreign_trades_delete BEFORE DELETE ON trades
WHEN OLD.conversion IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=4)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;

--> statement-breakpoint
CREATE TRIGGER protect_foreign_holding_snapshots_update BEFORE UPDATE ON holding_snapshots
WHEN OLD.conversion IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=4)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;

--> statement-breakpoint
CREATE TRIGGER protect_foreign_holding_snapshots_delete BEFORE DELETE ON holding_snapshots
WHEN OLD.conversion IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=4)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;

--> statement-breakpoint
CREATE TRIGGER protect_foreign_investment_account BEFORE UPDATE OF currency,type,opening_date ON accounts
WHEN EXISTS (SELECT 1 FROM trades WHERE owner_id=OLD.owner_id AND account_id=OLD.id AND conversion IS NOT NULL AND (NEW.currency!=currency OR NEW.type NOT IN ('investment','crypto') OR NEW.opening_date>date)) OR EXISTS (SELECT 1 FROM holding_snapshots WHERE owner_id=OLD.owner_id AND account_id=OLD.id AND conversion IS NOT NULL AND (NEW.currency!=currency OR NEW.type NOT IN ('investment','crypto') OR NEW.opening_date>date))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
