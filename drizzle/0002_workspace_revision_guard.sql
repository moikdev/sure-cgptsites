CREATE TRIGGER workspace_guard_revision
BEFORE INSERT ON workspace_guards
WHEN COALESCE((SELECT revision FROM profiles WHERE owner_id = NEW.owner_id), -1) != NEW.expected_revision
BEGIN
  SELECT RAISE(ABORT, 'workspace_changed');
END;
