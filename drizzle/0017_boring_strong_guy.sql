CREATE TABLE `rule_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`executed_at` text NOT NULL,
	`kind` text NOT NULL,
	`matched` integer NOT NULL,
	`modified` integer NOT NULL,
	`skipped` integer NOT NULL,
	`summary` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rule_runs_owner_date` ON `rule_runs` (`owner_id`,`executed_at`);--> statement-breakpoint
CREATE TABLE `transaction_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT 0 NOT NULL,
	`position` integer NOT NULL,
	`group_name` text DEFAULT '' NOT NULL,
	`effective_date` text,
	`currency` text,
	`stop_processing` integer DEFAULT 0 NOT NULL,
	`conditions` text NOT NULL,
	`actions` text NOT NULL,
	`blocked_reason` text,
	`source_json` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rule_enabled" CHECK("transaction_rules"."active" IN (0,1) AND "transaction_rules"."stop_processing" IN (0,1) AND ("transaction_rules"."blocked_reason" IS NULL OR "transaction_rules"."active"=0))
);
--> statement-breakpoint
CREATE INDEX `rules_owner_position` ON `transaction_rules` (`owner_id`,`position`);--> statement-breakpoint
ALTER TABLE `split_lines` ADD `locked_fields` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `locked_fields` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER track_transaction_rules_insert AFTER INSERT ON transaction_rules
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transaction_rules_update AFTER UPDATE ON transaction_rules
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transaction_rules_delete AFTER DELETE ON transaction_rules
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_rule_runs_insert AFTER INSERT ON rule_runs
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_rule_runs_update AFTER UPDATE ON rule_runs
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_rule_runs_delete AFTER DELETE ON rule_runs
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER lock_manual_transactions_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2)
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;

--> statement-breakpoint
CREATE TRIGGER lock_manual_split_lines_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2)
BEGIN UPDATE split_lines SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;

--> statement-breakpoint
CREATE TRIGGER lock_manual_transaction_inserts AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2)
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM json_each(json_array('name',CASE WHEN NEW.category_id IS NOT NULL THEN 'categoryId' END,CASE WHEN NEW.merchant_id IS NOT NULL THEN 'merchantId' END,CASE WHEN json_array_length(NEW.tag_ids)>0 THEN 'tagIds' END,CASE WHEN NEW.excluded!=0 THEN 'excluded' END)) WHERE value IS NOT NULL) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_inserts AFTER INSERT ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2)
BEGIN
 UPDATE split_lines SET locked_fields='["name","categoryId","merchantId","tagIds","excluded"]' WHERE owner_id=NEW.owner_id AND id=NEW.id;
 UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=NEW.owner_id AND id=NEW.transaction_id;
END;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_deletes AFTER DELETE ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=2)
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=OLD.owner_id AND id=OLD.transaction_id; END;

--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_categories BEFORE DELETE ON categories
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced categories record was deleted. Review and rebuild this rule.',source_json=json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions),'previous_source',source_json)),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='categoryId' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.categoryId') END=OLD.id) OR EXISTS (SELECT 1 FROM json_each(actions) a WHERE json_extract(a.value,'$.type')='categoryId' AND json_extract(a.value,'$.value')=OLD.id)); END;

--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_merchants BEFORE DELETE ON merchants
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced merchants record was deleted. Review and rebuild this rule.',source_json=json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions),'previous_source',source_json)),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='merchantId' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.merchantId') END=OLD.id) OR EXISTS (SELECT 1 FROM json_each(actions) a WHERE json_extract(a.value,'$.type')='merchantId' AND json_extract(a.value,'$.value')=OLD.id)); END;

--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_tags BEFORE DELETE ON tags
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced tags record was deleted. Review and rebuild this rule.',source_json=json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions),'previous_source',source_json)),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='tagIds' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.tagIds') END=OLD.id) OR EXISTS (SELECT 1 FROM json_each(actions) a,json_each(CASE WHEN json_extract(a.value,'$.type')='tagIds' THEN json_extract(a.value,'$.value') ELSE '[]' END) v WHERE v.value=OLD.id) OR EXISTS (SELECT 1 FROM json_tree(actions) n,json_each(CASE WHEN n.type='object' THEN COALESCE(json_extract(n.value,'$.tagIds'),'[]') ELSE '[]' END) v WHERE v.value=OLD.id)); END;

--> statement-breakpoint
CREATE TRIGGER invalidate_rules_deleted_accounts BEFORE DELETE ON accounts
BEGIN UPDATE transaction_rules SET active=0,blocked_reason='A referenced accounts record was deleted. Review and rebuild this rule.',source_json=json_object('saved_rule',json_object('name',name,'conditions',json(conditions),'actions',json(actions),'previous_source',source_json)),conditions='[]',actions='[]'
 WHERE owner_id=OLD.owner_id AND (EXISTS (SELECT 1 FROM json_tree(conditions) n WHERE CASE WHEN n.type='object' THEN json_extract(n.value,'$.field') END='accountId' AND CASE WHEN n.type='object' THEN json_extract(n.value,'$.value') END=OLD.id)); END;
