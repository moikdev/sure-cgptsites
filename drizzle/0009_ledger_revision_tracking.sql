CREATE TRIGGER track_tags_insert
AFTER INSERT ON tags
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_tags_update
AFTER UPDATE ON tags
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_tags_delete
AFTER DELETE ON tags
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_merchants_insert
AFTER INSERT ON merchants
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_merchants_update
AFTER UPDATE ON merchants
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_merchants_delete
AFTER DELETE ON merchants
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_split_lines_insert
AFTER INSERT ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_split_lines_update
AFTER UPDATE ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_split_lines_delete
AFTER DELETE ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_entries_insert
AFTER INSERT ON recurring_entries
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_entries_update
AFTER UPDATE ON recurring_entries
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_entries_delete
AFTER DELETE ON recurring_entries
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_occurrences_insert
AFTER INSERT ON recurring_occurrences
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_occurrences_update
AFTER UPDATE ON recurring_occurrences
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_occurrences_delete
AFTER DELETE ON recurring_occurrences
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_allocations_insert
AFTER INSERT ON recurring_allocations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_allocations_update
AFTER UPDATE ON recurring_allocations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = NEW.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_allocations_delete
AFTER DELETE ON recurring_allocations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id = OLD.owner_id)
BEGIN
  UPDATE profiles SET revision = revision + 1 WHERE owner_id = OLD.owner_id;
END;
