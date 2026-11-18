-- Preserve ordinary merchant-deletion behavior; reviewed merges rewrite every
-- supported reference atomically before deleting source merchants. Avoid repeating
-- the JSON rule scan for each of up to 4,999 removed merchant records.
CREATE INDEX transactions_owner_merchant ON transactions(owner_id,merchant_id);
--> statement-breakpoint
CREATE INDEX split_lines_owner_merchant ON split_lines(owner_id,merchant_id);
--> statement-breakpoint
CREATE INDEX recurring_entries_owner_merchant ON recurring_entries(owner_id,merchant_id);
--> statement-breakpoint
DROP TRIGGER invalidate_rules_deleted_merchants;
--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_merchants BEFORE DELETE ON merchants
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=28 AND substr(id,1,15)='merchant-merge:')
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced merchants record was deleted. Review and rebuild this rule.',source_json=COALESCE(source_json,json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions)))),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='merchantId' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.merchantId') END=OLD.id) OR EXISTS (SELECT 1 FROM json_each(actions) a WHERE json_extract(a.value,'$.type')='merchantId' AND json_extract(a.value,'$.value')=OLD.id)); END;
--> statement-breakpoint
CREATE TRIGGER merchant_merge_guard BEFORE INSERT ON workspace_guards
WHEN substr(NEW.id,1,15)='merchant-merge:' AND NEW.client_epoch!=28
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
