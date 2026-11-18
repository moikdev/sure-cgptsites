DROP TRIGGER invalidate_rules_deleted_categories;
--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_categories BEFORE DELETE ON categories
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced categories record was deleted. Review and rebuild this rule.',source_json=COALESCE(source_json,json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions)))),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='categoryId' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.categoryId') END=OLD.id) OR EXISTS (SELECT 1 FROM json_each(actions) a WHERE json_extract(a.value,'$.type')='categoryId' AND json_extract(a.value,'$.value')=OLD.id)); END;

--> statement-breakpoint
DROP TRIGGER invalidate_rules_deleted_merchants;
--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_merchants BEFORE DELETE ON merchants
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced merchants record was deleted. Review and rebuild this rule.',source_json=COALESCE(source_json,json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions)))),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='merchantId' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.merchantId') END=OLD.id) OR EXISTS (SELECT 1 FROM json_each(actions) a WHERE json_extract(a.value,'$.type')='merchantId' AND json_extract(a.value,'$.value')=OLD.id)); END;

--> statement-breakpoint
DROP TRIGGER invalidate_rules_deleted_tags;
--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_tags BEFORE DELETE ON tags
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced tags record was deleted. Review and rebuild this rule.',source_json=COALESCE(source_json,json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions)))),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='tagIds' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.tagIds') END=OLD.id) OR EXISTS (SELECT 1 FROM json_each(actions) a,json_each(CASE WHEN json_extract(a.value,'$.type')='tagIds' THEN json_extract(a.value,'$.value') ELSE '[]' END) v WHERE v.value=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n,json_each(CASE WHEN n.type='object' THEN COALESCE(json_extract(n.value,'$.tagIds'),'[]') ELSE '[]' END) v WHERE v.value=OLD.id)); END;

--> statement-breakpoint
DROP TRIGGER invalidate_rules_deleted_accounts;
--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_accounts BEFORE DELETE ON accounts
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced accounts record was deleted. Review and rebuild this rule.',source_json=COALESCE(source_json,json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions)))),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='accountId' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id)); END;

