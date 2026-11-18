ALTER TABLE `trades` ADD `excluded` integer;--> statement-breakpoint
ALTER TABLE `transactions` ADD `investment_activity` text;
--> statement-breakpoint
-- New recovery generation preserves explicit activity metadata and statement evidence.
DROP TRIGGER auto_transfer_disabled_insert;
--> statement-breakpoint
CREATE TRIGGER auto_transfer_disabled_insert BEFORE INSERT ON transfer_details WHEN NEW.status='pending' AND EXISTS(SELECT 1 FROM profiles WHERE owner_id=NEW.owner_id AND auto_transfer_disabled=1) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (33,37)) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
DROP TRIGGER auto_transfer_disabled_update;
--> statement-breakpoint
CREATE TRIGGER auto_transfer_disabled_update BEFORE UPDATE OF status ON transfer_details WHEN NEW.status='pending' AND NEW.status IS NOT OLD.status AND EXISTS(SELECT 1 FROM profiles WHERE owner_id=NEW.owner_id AND auto_transfer_disabled=1) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (33,37)) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
DROP TRIGGER investment_repair_footprint;
--> statement-breakpoint
CREATE TRIGGER investment_repair_footprint BEFORE UPDATE ON transactions
WHEN EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=36) AND
 (NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.transfer_id IS NOT OLD.transfer_id OR NEW.category_id IS NOT OLD.category_id OR NEW.name IS NOT OLD.name OR NEW.notes IS NOT OLD.notes OR NEW.import_key IS NOT OLD.import_key OR NEW.excluded IS NOT OLD.excluded OR NEW.merchant_id IS NOT OLD.merchant_id OR NEW.tag_ids IS NOT OLD.tag_ids OR NEW.locked_fields IS NOT OLD.locked_fields OR NEW.reconciled_status IS NOT OLD.reconciled_status OR NEW.reconciled_at IS NOT OLD.reconciled_at OR NEW.reconciled_statement_id IS NOT OLD.reconciled_statement_id OR NEW.investment_activity IS NOT OLD.investment_activity)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
DROP TRIGGER loan_replay_statement_review;
--> statement-breakpoint
CREATE TRIGGER loan_replay_statement_review AFTER UPDATE OF loan_replay,loan_terms ON accounts WHEN (NEW.loan_replay IS NOT OLD.loan_replay OR (NEW.loan_terms IS NOT OLD.loan_terms AND (OLD.loan_replay=1 OR NEW.loan_replay=1))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)) BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND completed_at IS NOT NULL; END;
--> statement-breakpoint
DROP TRIGGER reset_changed_transaction_reconciliation;
--> statement-breakpoint
CREATE TRIGGER reset_changed_transaction_reconciliation AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
 AND NOT (NEW.account_id IS OLD.account_id AND NEW.date IS OLD.date AND NEW.amount IS OLD.amount AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch=36))
BEGIN UPDATE transactions SET reconciled_status='unreconciled',reconciled_at=NULL,reconciled_statement_id=NULL WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER review_changed_statement_account;
--> statement-breakpoint
CREATE TRIGGER review_changed_statement_account AFTER UPDATE OF opening_balance,opening_date,type,currency ON accounts
WHEN (NEW.opening_balance IS NOT OLD.opening_balance OR NEW.opening_date IS NOT OLD.opening_date OR NEW.type IS NOT OLD.type OR NEW.currency IS NOT OLD.currency)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND completed_at IS NOT NULL; END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_delete AFTER DELETE ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_insert AFTER INSERT ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_update AFTER UPDATE OF account_id,date,security_id,qty,price,amount ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_delete AFTER DELETE ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_insert AFTER INSERT ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_update AFTER UPDATE OF account_id,date,amount ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_kind;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_kind AFTER UPDATE OF kind ON securities
WHEN NEW.kind IS NOT OLD.kind AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.owner_id=NEW.owner_id AND account_statements.completed_at IS NOT NULL AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.id AND h.date<=account_statements.period_end)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_delete AFTER DELETE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_insert AFTER INSERT ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_update AFTER UPDATE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.currency IS NOT OLD.currency OR NEW.price IS NOT OLD.price)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_delete AFTER DELETE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_insert AFTER INSERT ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_update AFTER UPDATE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.numerator IS NOT OLD.numerator OR NEW.denominator IS NOT OLD.denominator)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_delete AFTER DELETE ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_insert AFTER INSERT ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_update AFTER UPDATE OF account_id,date,security_id,qty,price,cash_amount,fee,activity,sequence ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.cash_amount IS NOT OLD.cash_amount OR NEW.fee IS NOT OLD.fee OR NEW.activity IS NOT OLD.activity OR NEW.sequence IS NOT OLD.sequence)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_delete AFTER DELETE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_insert AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_update AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_delete AFTER DELETE ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_insert AFTER INSERT ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_update AFTER UPDATE OF account_id,date,amount ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_unmarked_statement_transaction;
--> statement-breakpoint
CREATE TRIGGER review_unmarked_statement_transaction AFTER UPDATE OF reconciled_status ON transactions
WHEN OLD.reconciled_status='reconciled' AND NEW.reconciled_status!='reconciled' AND OLD.reconciled_statement_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33,37))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=OLD.owner_id AND id=OLD.reconciled_statement_id AND completed_at IS NOT NULL; END;
--> statement-breakpoint
CREATE TRIGGER investment_cash_label_insert BEFORE INSERT ON transactions WHEN NEW.investment_activity IS NOT NULL AND NEW.investment_activity NOT IN ('Buy','Sell','Sweep In','Sweep Out','Dividend','Reinvestment','Interest','Fee','Transfer','Contribution','Withdrawal','Exchange','Other') BEGIN SELECT RAISE(ABORT,'investment_reporting_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER investment_cash_label_update BEFORE UPDATE OF investment_activity ON transactions WHEN NEW.investment_activity IS NOT NULL AND NEW.investment_activity NOT IN ('Buy','Sell','Sweep In','Sweep Out','Dividend','Reinvestment','Interest','Fee','Transfer','Contribution','Withdrawal','Exchange','Other') BEGIN SELECT RAISE(ABORT,'investment_reporting_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER investment_trade_exclusion_insert BEFORE INSERT ON trades WHEN NEW.excluded IS NOT NULL AND NEW.excluded NOT IN (0,1) BEGIN SELECT RAISE(ABORT,'investment_reporting_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER investment_trade_exclusion_update BEFORE UPDATE OF excluded ON trades WHEN NEW.excluded IS NOT NULL AND NEW.excluded NOT IN (0,1) BEGIN SELECT RAISE(ABORT,'investment_reporting_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER investment_reporting_old_restore BEFORE INSERT ON workspace_guards WHEN (NEW.client_epoch=0 OR (NEW.client_epoch<37 AND NEW.client_epoch%2=1)) AND (EXISTS(SELECT 1 FROM transactions WHERE owner_id=NEW.owner_id AND investment_activity IS NOT NULL) OR EXISTS(SELECT 1 FROM trades WHERE owner_id=NEW.owner_id AND excluded IS NOT NULL)) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
