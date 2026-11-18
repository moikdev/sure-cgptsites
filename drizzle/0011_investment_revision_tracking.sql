CREATE TRIGGER track_securities_insert
AFTER INSERT ON securities
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_securities_update
AFTER UPDATE ON securities
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_securities_delete
AFTER DELETE ON securities
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_security_prices_insert
AFTER INSERT ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_security_prices_update
AFTER UPDATE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_security_prices_delete
AFTER DELETE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_trades_insert
AFTER INSERT ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_trades_update
AFTER UPDATE ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_trades_delete
AFTER DELETE ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_holding_snapshots_insert
AFTER INSERT ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_holding_snapshots_update
AFTER UPDATE ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_holding_snapshots_delete
AFTER DELETE ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_security_splits_insert
AFTER INSERT ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_security_splits_update
AFTER UPDATE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_security_splits_delete
AFTER DELETE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_investment_cash_balances_insert
AFTER INSERT ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_investment_cash_balances_update
AFTER UPDATE ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_investment_cash_balances_delete
AFTER DELETE ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
