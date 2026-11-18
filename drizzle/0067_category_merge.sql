-- Reviewed category merging uses indexed references and retains ordinary deletion behavior.
CREATE INDEX transactions_owner_category ON transactions(owner_id,category_id);
--> statement-breakpoint
CREATE INDEX split_lines_owner_category ON split_lines(owner_id,category_id);
--> statement-breakpoint
CREATE INDEX recurring_entries_owner_category ON recurring_entries(owner_id,category_id);
--> statement-breakpoint
CREATE INDEX budget_envelopes_owner_category ON budget_envelopes(owner_id,category_id);
--> statement-breakpoint
CREATE INDEX budgets_owner_category ON budgets(owner_id,category_id);
--> statement-breakpoint
CREATE INDEX categories_owner_parent ON categories(owner_id,parent_id);
--> statement-breakpoint
DROP TRIGGER invalidate_rules_deleted_categories;
--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_categories BEFORE DELETE ON categories
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=28 AND substr(id,1,15)='category-merge:')
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced categories record was deleted. Review and rebuild this rule.',source_json=COALESCE(source_json,json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions)))),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='categoryId' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.categoryId') END=OLD.id) OR EXISTS (SELECT 1 FROM json_each(actions) a WHERE json_extract(a.value,'$.type')='categoryId' AND json_extract(a.value,'$.value')=OLD.id)); END;
--> statement-breakpoint
CREATE TRIGGER category_merge_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,15)='category-merge:' AND NEW.client_epoch!=28
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
