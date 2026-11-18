CREATE TRIGGER protect_budget_hierarchy_deletes
BEFORE DELETE ON categories
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=1)
BEGIN
 SELECT RAISE(ABORT,'workspace_changed');
END;
--> statement-breakpoint
CREATE TRIGGER protect_budget_account_deletes
BEFORE DELETE ON accounts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=1)
 AND EXISTS (SELECT 1 FROM budget_books b, json_each(b.account_ids) a WHERE b.owner_id=OLD.owner_id AND a.value=OLD.id)
BEGIN
 SELECT RAISE(ABORT,'workspace_changed');
END;
