CREATE TRIGGER track_accounts_insert
AFTER INSERT ON accounts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_accounts_update
AFTER UPDATE ON accounts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_accounts_delete
AFTER DELETE ON accounts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_categories_insert
AFTER INSERT ON categories
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_categories_update
AFTER UPDATE ON categories
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_categories_delete
AFTER DELETE ON categories
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_transactions_insert
AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_transactions_update
AFTER UPDATE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_transactions_delete
AFTER DELETE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_valuations_insert
AFTER INSERT ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_valuations_update
AFTER UPDATE ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_valuations_delete
AFTER DELETE ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budgets_insert
AFTER INSERT ON budgets
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budgets_update
AFTER UPDATE ON budgets
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budgets_delete
AFTER DELETE ON budgets
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_profile_preferences
AFTER UPDATE OF name, currency ON profiles
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
