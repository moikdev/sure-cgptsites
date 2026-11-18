ALTER TABLE `recurring_entries` ADD `last_occurrence_on` text;--> statement-breakpoint
ALTER TABLE `recurring_entries` ADD `occurrence_count` integer;--> statement-breakpoint
ALTER TABLE `recurring_entries` ADD `updated_at` text;
--> statement-breakpoint
INSERT INTO workspace_guards(id,owner_id,expected_revision,client_epoch) SELECT 'migration-recurring-observations:'||owner_id,owner_id,revision,19 FROM profiles p WHERE EXISTS(SELECT 1 FROM recurring_entries e WHERE e.owner_id=p.owner_id) AND NOT EXISTS(SELECT 1 FROM workspace_guards g WHERE g.owner_id=p.owner_id);
--> statement-breakpoint
UPDATE recurring_entries SET last_occurrence_on=json_extract(matching,'$.sourceHints.sites_detection.lastObservedOn'),occurrence_count=CASE WHEN json_type(matching,'$.sourceHints.sites_detection.occurrenceCount')='integer' AND json_extract(matching,'$.sourceHints.sites_detection.occurrenceCount') BETWEEN 0 AND 1000000000 THEN json_extract(matching,'$.sourceHints.sites_detection.occurrenceCount') ELSE NULL END WHERE matching IS NOT NULL AND json_valid(matching) AND json_type(matching,'$.sourceHints.sites_detection.lastObservedOn')='text' AND json_extract(matching,'$.sourceHints.sites_detection.lastObservedOn') BETWEEN '1900-01-01' AND '2199-12-31' AND date(json_extract(matching,'$.sourceHints.sites_detection.lastObservedOn'),'+0 days') IS json_extract(matching,'$.sourceHints.sites_detection.lastObservedOn');
--> statement-breakpoint
DELETE FROM workspace_guards WHERE id='migration-recurring-observations:'||owner_id;
--> statement-breakpoint
CREATE TRIGGER observation_old_restore BEFORE INSERT ON workspace_guards WHEN NEW.client_epoch IN (3,5,7,9,11,13,15,17) AND EXISTS(SELECT 1 FROM recurring_entries WHERE owner_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER observation_recurring_insert BEFORE INSERT ON recurring_entries WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=18) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER observation_recurring_update BEFORE UPDATE ON recurring_entries WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=18) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER observation_recurring_delete BEFORE DELETE ON recurring_entries WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=18) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER observation_valid_insert BEFORE INSERT ON recurring_entries WHEN (NEW.last_occurrence_on IS NOT NULL AND (typeof(NEW.last_occurrence_on)!='text' OR length(NEW.last_occurrence_on)!=10 OR NEW.last_occurrence_on<'1900-01-01' OR NEW.last_occurrence_on>'2199-12-31' OR date(NEW.last_occurrence_on,'+0 days') IS NOT NEW.last_occurrence_on)) OR (NEW.occurrence_count IS NOT NULL AND (typeof(NEW.occurrence_count)!='integer' OR NEW.occurrence_count NOT BETWEEN 0 AND 1000000000)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at)!='text' OR length(NEW.updated_at)!=24 OR substr(NEW.updated_at,1,10)<'1900-01-01' OR substr(NEW.updated_at,1,10)>'2199-12-31' OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at) IS NOT NEW.updated_at)) BEGIN SELECT RAISE(ABORT,'invalid_recurring_observation'); END;
--> statement-breakpoint
CREATE TRIGGER observation_valid_update BEFORE UPDATE ON recurring_entries WHEN (NEW.last_occurrence_on IS NOT NULL AND (typeof(NEW.last_occurrence_on)!='text' OR length(NEW.last_occurrence_on)!=10 OR NEW.last_occurrence_on<'1900-01-01' OR NEW.last_occurrence_on>'2199-12-31' OR date(NEW.last_occurrence_on,'+0 days') IS NOT NEW.last_occurrence_on)) OR (NEW.occurrence_count IS NOT NULL AND (typeof(NEW.occurrence_count)!='integer' OR NEW.occurrence_count NOT BETWEEN 0 AND 1000000000)) OR (NEW.updated_at IS NOT NULL AND (typeof(NEW.updated_at)!='text' OR length(NEW.updated_at)!=24 OR substr(NEW.updated_at,1,10)<'1900-01-01' OR substr(NEW.updated_at,1,10)>'2199-12-31' OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at) IS NOT NEW.updated_at)) BEGIN SELECT RAISE(ABORT,'invalid_recurring_observation'); END;
--> statement-breakpoint
CREATE TRIGGER observation_touch_insert AFTER INSERT ON recurring_entries WHEN NEW.updated_at IS NULL BEGIN UPDATE recurring_entries SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER observation_touch_update AFTER UPDATE ON recurring_entries WHEN NEW.updated_at IS OLD.updated_at AND (NEW.name IS NOT OLD.name OR NEW.account_id IS NOT OLD.account_id OR NEW.destination_account_id IS NOT OLD.destination_account_id OR NEW.category_id IS NOT OLD.category_id OR NEW.merchant_id IS NOT OLD.merchant_id OR NEW.tag_ids IS NOT OLD.tag_ids OR NEW.amount IS NOT OLD.amount OR NEW.currency IS NOT OLD.currency OR NEW.bill_type IS NOT OLD.bill_type OR NEW.status IS NOT OLD.status OR NEW.anchor_date IS NOT OLD.anchor_date OR NEW.starts_on IS NOT OLD.starts_on OR NEW.expected_day_of_month IS NOT OLD.expected_day_of_month OR NEW.rules IS NOT OLD.rules OR NEW.end_mode IS NOT OLD.end_mode OR NEW.end_on IS NOT OLD.end_on OR NEW.end_after_count IS NOT OLD.end_after_count OR NEW.weekend_adjust IS NOT OLD.weekend_adjust OR NEW.amount_strategy IS NOT OLD.amount_strategy OR NEW.expected_amount_min IS NOT OLD.expected_amount_min OR NEW.expected_amount_max IS NOT OLD.expected_amount_max OR NEW.expected_amount_avg IS NOT OLD.expected_amount_avg OR NEW.notify_days_before IS NOT OLD.notify_days_before OR NEW.overdue_grace_days IS NOT OLD.overdue_grace_days OR NEW.notes IS NOT OLD.notes OR NEW.payment_url IS NOT OLD.payment_url OR NEW.autopay IS NOT OLD.autopay OR NEW.matching IS NOT OLD.matching OR NEW.renews_on IS NOT OLD.renews_on OR NEW.trial_ends_on IS NOT OLD.trial_ends_on OR NEW.cancelled_on IS NOT OLD.cancelled_on OR NEW.manual IS NOT OLD.manual OR NEW.last_occurrence_on IS NOT OLD.last_occurrence_on OR NEW.occurrence_count IS NOT OLD.occurrence_count) BEGIN UPDATE recurring_entries SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER reset_changed_transaction_reconciliation;
--> statement-breakpoint
CREATE TRIGGER reset_changed_transaction_reconciliation AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE transactions SET reconciled_status='unreconciled',reconciled_at=NULL,reconciled_statement_id=NULL WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER review_changed_statement_account;
--> statement-breakpoint
CREATE TRIGGER review_changed_statement_account AFTER UPDATE OF opening_balance,opening_date,type,currency ON accounts
WHEN (NEW.opening_balance IS NOT OLD.opening_balance OR NEW.opening_date IS NOT OLD.opening_date OR NEW.type IS NOT OLD.type OR NEW.currency IS NOT OLD.currency)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND completed_at IS NOT NULL; END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_delete AFTER DELETE ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_insert AFTER INSERT ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_update AFTER UPDATE OF account_id,date,security_id,qty,price,amount ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_delete AFTER DELETE ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_insert AFTER INSERT ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_update AFTER UPDATE OF account_id,date,amount ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_kind;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_kind AFTER UPDATE OF kind ON securities
WHEN NEW.kind IS NOT OLD.kind AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.owner_id=NEW.owner_id AND account_statements.completed_at IS NOT NULL AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.id AND h.date<=account_statements.period_end)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_delete AFTER DELETE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_insert AFTER INSERT ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_update AFTER UPDATE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.currency IS NOT OLD.currency OR NEW.price IS NOT OLD.price)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_delete AFTER DELETE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_insert AFTER INSERT ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_update AFTER UPDATE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.numerator IS NOT OLD.numerator OR NEW.denominator IS NOT OLD.denominator)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_delete AFTER DELETE ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_insert AFTER INSERT ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_update AFTER UPDATE OF account_id,date,security_id,qty,price,cash_amount,fee,activity,sequence ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.cash_amount IS NOT OLD.cash_amount OR NEW.fee IS NOT OLD.fee OR NEW.activity IS NOT OLD.activity OR NEW.sequence IS NOT OLD.sequence)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_delete AFTER DELETE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_insert AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_update AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_delete AFTER DELETE ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_insert AFTER INSERT ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_update AFTER UPDATE OF account_id,date,amount ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_unmarked_statement_transaction;
--> statement-breakpoint
CREATE TRIGGER review_unmarked_statement_transaction AFTER UPDATE OF reconciled_status ON transactions
WHEN OLD.reconciled_status='reconciled' AND NEW.reconciled_status!='reconciled' AND OLD.reconciled_statement_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=OLD.owner_id AND id=OLD.reconciled_statement_id AND completed_at IS NOT NULL; END;

--> statement-breakpoint
DROP TRIGGER lock_manual_transactions_updates;
--> statement-breakpoint
CREATE TRIGGER lock_manual_transactions_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18))
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;

--> statement-breakpoint
DROP TRIGGER lock_manual_split_lines_updates;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_lines_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18))
BEGIN UPDATE split_lines SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;

--> statement-breakpoint
DROP TRIGGER lock_manual_transaction_inserts;
--> statement-breakpoint
CREATE TRIGGER lock_manual_transaction_inserts AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18))
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM json_each(json_array('name',CASE WHEN NEW.category_id IS NOT NULL THEN 'categoryId' END,CASE WHEN NEW.merchant_id IS NOT NULL THEN 'merchantId' END,CASE WHEN json_array_length(NEW.tag_ids)>0 THEN 'tagIds' END,CASE WHEN NEW.excluded!=0 THEN 'excluded' END)) WHERE value IS NOT NULL) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER lock_manual_split_inserts;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_inserts AFTER INSERT ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18))
BEGIN
 UPDATE split_lines SET locked_fields='["name","categoryId","merchantId","tagIds","excluded"]' WHERE owner_id=NEW.owner_id AND id=NEW.id;
 UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=NEW.owner_id AND id=NEW.transaction_id;
END;
--> statement-breakpoint
DROP TRIGGER lock_manual_split_deletes;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_deletes AFTER DELETE ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18))
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=OLD.owner_id AND id=OLD.transaction_id; END;
