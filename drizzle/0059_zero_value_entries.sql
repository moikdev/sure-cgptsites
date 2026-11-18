-- Widen two amount CHECK constraints without changing existing financial records.
-- D1 keeps ON DELETE CASCADE active even with deferred foreign-key checks.
-- Preserve the seven affected tables; leave all other table rows and callbacks untouched.
PRAGMA defer_foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE "__sure59_csv_import_entries" AS SELECT "owner_id","import_id","transaction_id" FROM "csv_import_entries";
--> statement-breakpoint
CREATE TABLE "__sure59_native_source_transactions" AS SELECT "owner_id","source_id","transaction_id" FROM "native_source_transactions";
--> statement-breakpoint
CREATE TABLE "__sure59_recurring_match_rejections" AS SELECT "id","owner_id","recurring_entry_id","transaction_id","split_line_id" FROM "recurring_match_rejections";
--> statement-breakpoint
CREATE TABLE "__sure59_split_lines" AS SELECT "id","owner_id","transaction_id","position","name","amount","category_id","merchant_id","tag_ids","notes","kind","excluded","locked_fields" FROM "split_lines";
--> statement-breakpoint
CREATE TABLE "__sure59_transaction_receipts" AS SELECT "id","owner_id","transaction_id","file_id","created_at" FROM "transaction_receipts";
--> statement-breakpoint
CREATE TABLE "__sure59_transactions" AS SELECT "id","owner_id","account_id","category_id","date","name","amount","kind","transfer_id","notes","import_key","excluded","merchant_id","tag_ids","locked_fields","reconciled_status","reconciled_at","reconciled_statement_id","investment_activity" FROM "transactions";
--> statement-breakpoint
CREATE TABLE "__sure59_transfer_match_rejections" AS SELECT "id","owner_id","outflow_transaction_id","inflow_transaction_id","created_at","updated_at" FROM "transfer_match_rejections";
--> statement-breakpoint
DROP TRIGGER "investment_cash_label_insert";
--> statement-breakpoint
DROP TRIGGER "investment_cash_label_update";
--> statement-breakpoint
DROP TRIGGER "investment_repair_eligibility";
--> statement-breakpoint
DROP TRIGGER "investment_repair_footprint";
--> statement-breakpoint
DROP TRIGGER "kind_choice_delete";
--> statement-breakpoint
DROP TRIGGER "kind_choice_insert";
--> statement-breakpoint
DROP TRIGGER "kind_choice_update";
--> statement-breakpoint
DROP TRIGGER "loan_replay_transaction_delete";
--> statement-breakpoint
DROP TRIGGER "loan_replay_transaction_insert";
--> statement-breakpoint
DROP TRIGGER "loan_replay_transaction_update";
--> statement-breakpoint
DROP TRIGGER "lock_manual_split_deletes";
--> statement-breakpoint
DROP TRIGGER "lock_manual_split_inserts";
--> statement-breakpoint
DROP TRIGGER "lock_manual_split_lines_updates";
--> statement-breakpoint
DROP TRIGGER "lock_manual_transaction_inserts";
--> statement-breakpoint
DROP TRIGGER "lock_manual_transactions_updates";
--> statement-breakpoint
DROP TRIGGER "matcher_rejection_immutable";
--> statement-breakpoint
DROP TRIGGER "matcher_rejection_insert";
--> statement-breakpoint
DROP TRIGGER "native_source_transactions_claim";
--> statement-breakpoint
DROP TRIGGER "native_source_transactions_immutable";
--> statement-breakpoint
DROP TRIGGER "pending_transaction_delete";
--> statement-breakpoint
DROP TRIGGER "pending_transaction_update";
--> statement-breakpoint
DROP TRIGGER "protect_goal_consumption_transaction";
--> statement-breakpoint
DROP TRIGGER "protect_payment_conversion_split";
--> statement-breakpoint
DROP TRIGGER "protect_payment_conversion_transaction";
--> statement-breakpoint
DROP TRIGGER "receipt_file_insert";
--> statement-breakpoint
DROP TRIGGER "receipt_file_update";
--> statement-breakpoint
DROP TRIGGER "receipt_limit_insert";
--> statement-breakpoint
DROP TRIGGER "receipt_limit_update";
--> statement-breakpoint
DROP TRIGGER "reset_changed_transaction_reconciliation";
--> statement-breakpoint
DROP TRIGGER "review_statement_transactions_delete";
--> statement-breakpoint
DROP TRIGGER "review_statement_transactions_insert";
--> statement-breakpoint
DROP TRIGGER "review_statement_transactions_update";
--> statement-breakpoint
DROP TRIGGER "review_unmarked_statement_transaction";
--> statement-breakpoint
DROP TRIGGER "track_recurring_match_rejections_delete";
--> statement-breakpoint
DROP TRIGGER "track_recurring_match_rejections_insert";
--> statement-breakpoint
DROP TRIGGER "track_recurring_match_rejections_update";
--> statement-breakpoint
DROP TRIGGER "track_split_lines_delete";
--> statement-breakpoint
DROP TRIGGER "track_split_lines_insert";
--> statement-breakpoint
DROP TRIGGER "track_split_lines_update";
--> statement-breakpoint
DROP TRIGGER "track_transaction_receipts_delete";
--> statement-breakpoint
DROP TRIGGER "track_transaction_receipts_insert";
--> statement-breakpoint
DROP TRIGGER "track_transaction_receipts_update";
--> statement-breakpoint
DROP TRIGGER "track_transactions_delete";
--> statement-breakpoint
DROP TRIGGER "track_transactions_insert";
--> statement-breakpoint
DROP TRIGGER "track_transactions_update";
--> statement-breakpoint
DROP TRIGGER "track_transfer_rejections_delete";
--> statement-breakpoint
DROP TRIGGER "track_transfer_rejections_insert";
--> statement-breakpoint
DROP TRIGGER "track_transfer_rejections_update";
--> statement-breakpoint
DROP TRIGGER "transfer_rejection_dates_insert";
--> statement-breakpoint
DROP TRIGGER "transfer_rejection_dates_update";
--> statement-breakpoint
DROP TRIGGER "transfer_rejection_guard_delete";
--> statement-breakpoint
DROP TRIGGER "transfer_rejection_guard_insert";
--> statement-breakpoint
DROP TRIGGER "transfer_rejection_guard_update";
--> statement-breakpoint
DROP TRIGGER "unlink_deleted_pledge_transaction";
--> statement-breakpoint
DROP TRIGGER "unlink_goal_transaction";
--> statement-breakpoint
DROP TRIGGER "unlink_payment_split_before_delete";
--> statement-breakpoint
DROP TRIGGER "unlink_recurring_price_transaction";
--> statement-breakpoint
DROP TRIGGER "validate_statement_transaction_insert";
--> statement-breakpoint
DROP TRIGGER "validate_statement_transaction_update";
--> statement-breakpoint
DROP TABLE "transactions";
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`transfer_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`import_key` text, `excluded` integer DEFAULT 0 NOT NULL, `merchant_id` text, `tag_ids` text DEFAULT '[]' NOT NULL, `locked_fields` text DEFAULT '[]' NOT NULL, `reconciled_status` text DEFAULT 'unreconciled' NOT NULL, `reconciled_at` text, `reconciled_statement_id` text, `investment_activity` text,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`category_id`) REFERENCES `categories`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transaction_amount_range" CHECK(abs("transactions"."amount") <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_import_key` ON `transactions` (`owner_id`,`account_id`,`import_key`);
--> statement-breakpoint
CREATE INDEX `transactions_owner_date` ON `transactions` (`owner_id`,`date`);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_owner_id` ON `transactions` (`owner_id`,`id`);
--> statement-breakpoint
CREATE INDEX `transactions_transfer` ON `transactions` (`owner_id`,`transfer_id`);
--> statement-breakpoint
DROP TABLE "split_lines";
--> statement-breakpoint
CREATE TABLE `split_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`category_id` text,
	`merchant_id` text,
	`tag_ids` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'standard' NOT NULL,
	`excluded` integer DEFAULT 0 NOT NULL, `locked_fields` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`category_id`) REFERENCES `categories`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`merchant_id`) REFERENCES `merchants`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "split_amount_range" CHECK(abs("split_lines"."amount") <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `split_line_position` ON `split_lines` (`owner_id`,`transaction_id`,`position`);
--> statement-breakpoint
CREATE UNIQUE INDEX `split_lines_owner_id` ON `split_lines` (`owner_id`,`id`);
--> statement-breakpoint
INSERT INTO "transactions"("id","owner_id","account_id","category_id","date","name","amount","kind","transfer_id","notes","import_key","excluded","merchant_id","tag_ids","locked_fields","reconciled_status","reconciled_at","reconciled_statement_id","investment_activity") SELECT "id","owner_id","account_id","category_id","date","name","amount","kind","transfer_id","notes","import_key","excluded","merchant_id","tag_ids","locked_fields","reconciled_status","reconciled_at","reconciled_statement_id","investment_activity" FROM "__sure59_transactions";
--> statement-breakpoint
INSERT INTO "split_lines"("id","owner_id","transaction_id","position","name","amount","category_id","merchant_id","tag_ids","notes","kind","excluded","locked_fields") SELECT "id","owner_id","transaction_id","position","name","amount","category_id","merchant_id","tag_ids","notes","kind","excluded","locked_fields" FROM "__sure59_split_lines";
--> statement-breakpoint
INSERT INTO "csv_import_entries"("owner_id","import_id","transaction_id") SELECT "owner_id","import_id","transaction_id" FROM "__sure59_csv_import_entries";
--> statement-breakpoint
INSERT INTO "native_source_transactions"("owner_id","source_id","transaction_id") SELECT "owner_id","source_id","transaction_id" FROM "__sure59_native_source_transactions";
--> statement-breakpoint
INSERT INTO "recurring_match_rejections"("id","owner_id","recurring_entry_id","transaction_id","split_line_id") SELECT "id","owner_id","recurring_entry_id","transaction_id","split_line_id" FROM "__sure59_recurring_match_rejections";
--> statement-breakpoint
INSERT INTO "transaction_receipts"("id","owner_id","transaction_id","file_id","created_at") SELECT "id","owner_id","transaction_id","file_id","created_at" FROM "__sure59_transaction_receipts";
--> statement-breakpoint
INSERT INTO "transfer_match_rejections"("id","owner_id","outflow_transaction_id","inflow_transaction_id","created_at","updated_at") SELECT "id","owner_id","outflow_transaction_id","inflow_transaction_id","created_at","updated_at" FROM "__sure59_transfer_match_rejections";
--> statement-breakpoint
DROP TABLE "__sure59_csv_import_entries";
--> statement-breakpoint
DROP TABLE "__sure59_native_source_transactions";
--> statement-breakpoint
DROP TABLE "__sure59_recurring_match_rejections";
--> statement-breakpoint
DROP TABLE "__sure59_split_lines";
--> statement-breakpoint
DROP TABLE "__sure59_transaction_receipts";
--> statement-breakpoint
DROP TABLE "__sure59_transactions";
--> statement-breakpoint
DROP TABLE "__sure59_transfer_match_rejections";
--> statement-breakpoint
CREATE TRIGGER investment_cash_label_insert BEFORE INSERT ON transactions WHEN NEW.investment_activity IS NOT NULL AND NEW.investment_activity NOT IN ('Buy','Sell','Sweep In','Sweep Out','Dividend','Reinvestment','Interest','Fee','Transfer','Contribution','Withdrawal','Exchange','Other') BEGIN SELECT RAISE(ABORT,'investment_reporting_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER investment_cash_label_update BEFORE UPDATE OF investment_activity ON transactions WHEN NEW.investment_activity IS NOT NULL AND NEW.investment_activity NOT IN ('Buy','Sell','Sweep In','Sweep Out','Dividend','Reinvestment','Interest','Fee','Transfer','Contribution','Withdrawal','Exchange','Other') BEGIN SELECT RAISE(ABORT,'investment_reporting_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER investment_repair_eligibility BEFORE UPDATE OF kind ON transactions
WHEN NEW.kind IS NOT OLD.kind AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=36) AND
 (OLD.kind NOT IN ('funds_movement','cc_payment','loan_payment','investment_contribution') OR OLD.excluded!=0 OR EXISTS(SELECT 1 FROM json_each(OLD.locked_fields) WHERE value='kind') OR NOT EXISTS(
 SELECT 1 FROM transactions incoming JOIN accounts destination ON destination.owner_id=incoming.owner_id AND destination.id=incoming.account_id JOIN accounts source ON source.owner_id=OLD.owner_id AND source.id=OLD.account_id
 WHERE incoming.owner_id=OLD.owner_id AND incoming.transfer_id=OLD.transfer_id AND incoming.amount>0 AND destination.type IN ('investment','crypto')
 AND NEW.kind=CASE WHEN OLD.amount>0 OR source.type IN ('investment','crypto') THEN 'funds_movement' ELSE 'investment_contribution' END
 ))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER investment_repair_footprint BEFORE UPDATE ON transactions
WHEN EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=36) AND
 (NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.transfer_id IS NOT OLD.transfer_id OR NEW.category_id IS NOT OLD.category_id OR NEW.name IS NOT OLD.name OR NEW.notes IS NOT OLD.notes OR NEW.import_key IS NOT OLD.import_key OR NEW.excluded IS NOT OLD.excluded OR NEW.merchant_id IS NOT OLD.merchant_id OR NEW.tag_ids IS NOT OLD.tag_ids OR NEW.locked_fields IS NOT OLD.locked_fields OR NEW.reconciled_status IS NOT OLD.reconciled_status OR NEW.reconciled_at IS NOT OLD.reconciled_at OR NEW.reconciled_statement_id IS NOT OLD.reconciled_statement_id OR NEW.investment_activity IS NOT OLD.investment_activity)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER kind_choice_delete BEFORE DELETE ON transactions WHEN EXISTS(SELECT 1 FROM json_each(OLD.locked_fields) WHERE value='kind') AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=24) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER kind_choice_insert BEFORE INSERT ON transactions WHEN EXISTS(SELECT 1 FROM json_each(NEW.locked_fields) WHERE value='kind') AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=24) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER kind_choice_update BEFORE UPDATE OF kind,locked_fields ON transactions WHEN ((NEW.kind IS NOT OLD.kind AND EXISTS(SELECT 1 FROM json_each(OLD.locked_fields) WHERE value='kind')) OR (EXISTS(SELECT 1 FROM json_each(NEW.locked_fields) WHERE value='kind') != EXISTS(SELECT 1 FROM json_each(OLD.locked_fields) WHERE value='kind'))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=24) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_transaction_delete BEFORE DELETE ON transactions WHEN (EXISTS(SELECT 1 FROM accounts WHERE owner_id=OLD.owner_id AND id=OLD.account_id AND loan_replay=1) OR (OLD.transfer_id IS NOT NULL AND EXISTS(SELECT 1 FROM transactions t JOIN accounts a ON a.owner_id=t.owner_id AND a.id=t.account_id WHERE t.owner_id=OLD.owner_id AND t.transfer_id=OLD.transfer_id AND a.loan_replay=1))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_transaction_insert BEFORE INSERT ON transactions WHEN (EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND loan_replay=1) OR (NEW.transfer_id IS NOT NULL AND EXISTS(SELECT 1 FROM transactions t JOIN accounts a ON a.owner_id=t.owner_id AND a.id=t.account_id WHERE t.owner_id=NEW.owner_id AND t.transfer_id=NEW.transfer_id AND a.loan_replay=1))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_transaction_update BEFORE UPDATE ON transactions WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.transfer_id IS NOT OLD.transfer_id) AND (EXISTS(SELECT 1 FROM accounts WHERE owner_id=OLD.owner_id AND id=OLD.account_id AND loan_replay=1) OR (OLD.transfer_id IS NOT NULL AND EXISTS(SELECT 1 FROM transactions t JOIN accounts a ON a.owner_id=t.owner_id AND a.id=t.account_id WHERE t.owner_id=OLD.owner_id AND t.transfer_id=OLD.transfer_id AND a.loan_replay=1)) OR EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND loan_replay=1) OR (NEW.transfer_id IS NOT NULL AND EXISTS(SELECT 1 FROM transactions t JOIN accounts a ON a.owner_id=t.owner_id AND a.id=t.account_id WHERE t.owner_id=NEW.owner_id AND t.transfer_id=NEW.transfer_id AND a.loan_replay=1))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_deletes AFTER DELETE ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20,24,28))
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=OLD.owner_id AND id=OLD.transaction_id; END;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_inserts AFTER INSERT ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20,24,28))
BEGIN
 UPDATE split_lines SET locked_fields='["name","categoryId","merchantId","tagIds","excluded"]' WHERE owner_id=NEW.owner_id AND id=NEW.id;
 UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=NEW.owner_id AND id=NEW.transaction_id;
END;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_lines_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20,24,28))
BEGIN UPDATE split_lines SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER lock_manual_transaction_inserts AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20,24,28))
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM json_each(json_array('name',CASE WHEN NEW.category_id IS NOT NULL THEN 'categoryId' END,CASE WHEN NEW.merchant_id IS NOT NULL THEN 'merchantId' END,CASE WHEN json_array_length(NEW.tag_ids)>0 THEN 'tagIds' END,CASE WHEN NEW.excluded!=0 THEN 'excluded' END)) WHERE value IS NOT NULL) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER lock_manual_transactions_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20,24,28))
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER matcher_rejection_immutable BEFORE UPDATE ON recurring_match_rejections
BEGIN SELECT RAISE(ABORT,'immutable_match_rejection'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_rejection_insert BEFORE INSERT ON recurring_match_rejections
WHEN (SELECT count(*) FROM recurring_match_rejections WHERE owner_id=NEW.owner_id)>=10000 OR
 (NEW.split_line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM split_lines WHERE owner_id=NEW.owner_id AND id=NEW.split_line_id AND transaction_id=NEW.transaction_id))
BEGIN SELECT RAISE(ABORT,'invalid_match_rejection'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_transactions_claim BEFORE INSERT ON native_source_transactions
WHEN NOT EXISTS(SELECT 1 FROM native_import_sources s JOIN workspace_guards g ON g.owner_id=s.owner_id WHERE s.owner_id=NEW.owner_id AND s.id=NEW.source_id AND s.status='ready' AND g.client_epoch=37 AND substr(g.id,1,30)='category-restore:native-merge:' AND substr(g.id,-36)=COALESCE(s.active_request_id,s.request_id))
BEGIN SELECT RAISE(ABORT,'native_source_claim_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER native_source_transactions_immutable BEFORE UPDATE ON native_source_transactions BEGIN SELECT RAISE(ABORT,'native_source_claim_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pending_transaction_delete BEFORE DELETE ON transactions WHEN EXISTS(SELECT 1 FROM transfer_details WHERE owner_id=OLD.owner_id AND id=OLD.transfer_id AND status='pending') AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=28) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER pending_transaction_update BEFORE UPDATE ON transactions WHEN (NEW.amount IS NOT OLD.amount OR NEW.date IS NOT OLD.date OR NEW.account_id IS NOT OLD.account_id OR NEW.transfer_id IS NOT OLD.transfer_id OR NEW.kind IS NOT OLD.kind) AND EXISTS(SELECT 1 FROM transfer_details WHERE owner_id=OLD.owner_id AND status='pending' AND (id=OLD.transfer_id OR id=NEW.transfer_id)) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=28) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER protect_goal_consumption_transaction BEFORE UPDATE OF amount,account_id,date,excluded,transfer_id ON transactions
WHEN EXISTS (SELECT 1 FROM goal_consumptions c WHERE c.owner_id=OLD.owner_id AND c.transaction_id=OLD.id
 AND (NEW.amount>=0 OR -NEW.amount<COALESCE(json_extract(c.conversion,'$.nativeAmount'),c.amount) OR NEW.account_id IS NOT c.account_id OR NEW.date IS NOT c.date OR NEW.excluded!=0 OR NEW.transfer_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER protect_payment_conversion_split BEFORE UPDATE OF amount ON split_lines
WHEN NEW.amount IS NOT OLD.amount AND EXISTS (SELECT 1 FROM recurring_allocations WHERE owner_id=OLD.owner_id AND split_line_id=OLD.id AND conversion IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER protect_payment_conversion_transaction BEFORE UPDATE OF amount,account_id,date ON transactions
WHEN (NEW.amount IS NOT OLD.amount OR NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date)
 AND EXISTS (SELECT 1 FROM recurring_allocations WHERE owner_id=OLD.owner_id AND transaction_id=OLD.id AND conversion IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_file_insert BEFORE INSERT ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM statement_files f WHERE f.owner_id=NEW.owner_id AND f.id=NEW.file_id AND f.byte_size BETWEEN 1 AND 10485760 AND f.content_type IN ('image/jpeg','image/png','image/gif','image/webp','application/pdf'))
BEGIN SELECT RAISE(ABORT,'receipt_file'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_file_update BEFORE UPDATE ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM statement_files f WHERE f.owner_id=NEW.owner_id AND f.id=NEW.file_id AND f.byte_size BETWEEN 1 AND 10485760 AND f.content_type IN ('image/jpeg','image/png','image/gif','image/webp','application/pdf'))
BEGIN SELECT RAISE(ABORT,'receipt_file'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_limit_insert BEFORE INSERT ON transaction_receipts
WHEN (SELECT count(*) FROM transaction_receipts WHERE owner_id=NEW.owner_id AND transaction_id=NEW.transaction_id)>=10 OR (SELECT count(*) FROM transaction_receipts WHERE owner_id=NEW.owner_id)>=5000
BEGIN SELECT RAISE(ABORT,'receipt_limit'); END;
--> statement-breakpoint
CREATE TRIGGER receipt_limit_update BEFORE UPDATE OF owner_id,transaction_id ON transaction_receipts
WHEN (SELECT count(*) FROM transaction_receipts WHERE owner_id=NEW.owner_id AND transaction_id=NEW.transaction_id AND id!=OLD.id)>=10 OR (SELECT count(*) FROM transaction_receipts WHERE owner_id=NEW.owner_id AND id!=OLD.id)>=5000
BEGIN SELECT RAISE(ABORT,'receipt_limit'); END;
--> statement-breakpoint
CREATE TRIGGER reset_changed_transaction_reconciliation AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
 AND NOT (NEW.account_id IS OLD.account_id AND NEW.date IS OLD.date AND NEW.amount IS OLD.amount AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch=36))
BEGIN UPDATE transactions SET reconciled_status='unreconciled',reconciled_at=NULL,reconciled_statement_id=NULL WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_delete AFTER DELETE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_insert AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_update AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
CREATE TRIGGER review_unmarked_statement_transaction AFTER UPDATE OF reconciled_status ON transactions
WHEN OLD.reconciled_status='reconciled' AND NEW.reconciled_status!='reconciled' AND OLD.reconciled_statement_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=OLD.owner_id AND id=OLD.reconciled_statement_id AND completed_at IS NOT NULL; END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_match_rejections_delete AFTER DELETE ON recurring_match_rejections
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_match_rejections_insert AFTER INSERT ON recurring_match_rejections
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_match_rejections_update AFTER UPDATE ON recurring_match_rejections
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_split_lines_delete
AFTER DELETE ON split_lines
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
CREATE TRIGGER track_transaction_receipts_delete AFTER DELETE ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_transaction_receipts_insert AFTER INSERT ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_transaction_receipts_update AFTER UPDATE ON transaction_receipts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_transactions_delete
AFTER DELETE ON transactions
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
CREATE TRIGGER track_transfer_rejections_delete AFTER DELETE ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_transfer_rejections_insert AFTER INSERT ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_transfer_rejections_update AFTER UPDATE ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_dates_insert BEFORE INSERT ON transfer_match_rejections WHEN (NEW.created_at IS NOT NULL AND (substr(NEW.created_at,1,10) NOT BETWEEN '1900-01-01' AND '2199-12-31' OR length(NEW.created_at)!=24 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at)) OR (NEW.updated_at IS NOT NULL AND (substr(NEW.updated_at,1,10) NOT BETWEEN '1900-01-01' AND '2199-12-31' OR length(NEW.updated_at)!=24 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at) IS NOT NEW.updated_at)) BEGIN SELECT RAISE(ABORT,'invalid_transfer_rejection_timestamp'); END;
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_dates_update BEFORE UPDATE ON transfer_match_rejections WHEN (NEW.created_at IS NOT NULL AND (substr(NEW.created_at,1,10) NOT BETWEEN '1900-01-01' AND '2199-12-31' OR length(NEW.created_at)!=24 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at)) OR (NEW.updated_at IS NOT NULL AND (substr(NEW.updated_at,1,10) NOT BETWEEN '1900-01-01' AND '2199-12-31' OR length(NEW.updated_at)!=24 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at) IS NOT NEW.updated_at)) BEGIN SELECT RAISE(ABORT,'invalid_transfer_rejection_timestamp'); END;
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_guard_delete BEFORE DELETE ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_guard_insert BEFORE INSERT ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_guard_update BEFORE UPDATE ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER unlink_deleted_pledge_transaction BEFORE DELETE ON transactions
BEGIN UPDATE goal_pledges SET matched_transaction_id=NULL WHERE owner_id=OLD.owner_id AND matched_transaction_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER unlink_goal_transaction BEFORE DELETE ON transactions
BEGIN UPDATE goal_consumptions SET transaction_id=NULL WHERE owner_id=OLD.owner_id AND transaction_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER unlink_payment_split_before_delete BEFORE DELETE ON split_lines
BEGIN UPDATE recurring_allocations SET transaction_id=NULL,split_line_id=NULL WHERE owner_id=OLD.owner_id AND split_line_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER unlink_recurring_price_transaction BEFORE DELETE ON transactions
BEGIN UPDATE recurring_price_changes SET transaction_id=NULL WHERE owner_id=OLD.owner_id AND transaction_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER validate_statement_transaction_insert BEFORE INSERT ON transactions
WHEN NEW.reconciled_status NOT IN ('unreconciled','cleared','reconciled') OR (NEW.reconciled_status='reconciled') != (NEW.reconciled_at IS NOT NULL)
 OR (NEW.reconciled_statement_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM account_statements WHERE account_statements.owner_id=NEW.owner_id AND account_statements.id=NEW.reconciled_statement_id AND account_statements.account_id=NEW.account_id AND NEW.date BETWEEN account_statements.period_start AND account_statements.period_end AND account_statements.completed_at IS NOT NULL AND NEW.reconciled_status='reconciled'))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER validate_statement_transaction_update BEFORE UPDATE OF reconciled_status,reconciled_at,reconciled_statement_id ON transactions
WHEN NEW.reconciled_status NOT IN ('unreconciled','cleared','reconciled') OR (NEW.reconciled_status='reconciled') != (NEW.reconciled_at IS NOT NULL)
 OR (NEW.reconciled_statement_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM account_statements WHERE account_statements.owner_id=NEW.owner_id AND account_statements.id=NEW.reconciled_statement_id AND account_statements.account_id=NEW.account_id AND NEW.date BETWEEN account_statements.period_start AND account_statements.period_end AND account_statements.completed_at IS NOT NULL AND NEW.reconciled_status='reconciled'))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
