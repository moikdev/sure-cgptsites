CREATE TABLE `transfer_match_rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`outflow_transaction_id` text NOT NULL,
	`inflow_transaction_id` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	FOREIGN KEY (`owner_id`,`outflow_transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`inflow_transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transfer_rejection_distinct" CHECK("transfer_match_rejections"."outflow_transaction_id"!="transfer_match_rejections"."inflow_transaction_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_rejections_owner_pair` ON `transfer_match_rejections` (`owner_id`,`outflow_transaction_id`,`inflow_transaction_id`);--> statement-breakpoint
CREATE INDEX `transfer_rejections_inflow` ON `transfer_match_rejections` (`owner_id`,`inflow_transaction_id`);
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_old_restore BEFORE INSERT ON workspace_guards WHEN NEW.client_epoch IN (3,5,7,9,11,13,15,17,19,21) AND EXISTS(SELECT 1 FROM transfer_match_rejections WHERE owner_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_guard_insert BEFORE INSERT ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_dates_insert BEFORE INSERT ON transfer_match_rejections WHEN (NEW.created_at IS NOT NULL AND (substr(NEW.created_at,1,10) NOT BETWEEN '1900-01-01' AND '2199-12-31' OR length(NEW.created_at)!=24 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at)) OR (NEW.updated_at IS NOT NULL AND (substr(NEW.updated_at,1,10) NOT BETWEEN '1900-01-01' AND '2199-12-31' OR length(NEW.updated_at)!=24 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at) IS NOT NEW.updated_at)) BEGIN SELECT RAISE(ABORT,'invalid_transfer_rejection_timestamp'); END;
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_guard_update BEFORE UPDATE ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER transfer_rejection_dates_update BEFORE UPDATE ON transfer_match_rejections WHEN (NEW.created_at IS NOT NULL AND (substr(NEW.created_at,1,10) NOT BETWEEN '1900-01-01' AND '2199-12-31' OR length(NEW.created_at)!=24 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.created_at) IS NOT NEW.created_at)) OR (NEW.updated_at IS NOT NULL AND (substr(NEW.updated_at,1,10) NOT BETWEEN '1900-01-01' AND '2199-12-31' OR length(NEW.updated_at)!=24 OR strftime('%Y-%m-%dT%H:%M:%fZ',NEW.updated_at) IS NOT NEW.updated_at)) BEGIN SELECT RAISE(ABORT,'invalid_transfer_rejection_timestamp'); END;
--> statement-breakpoint
CREATE TRIGGER track_transfer_rejections_insert AFTER INSERT ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_transfer_rejections_update AFTER UPDATE ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_transfer_rejections_delete AFTER DELETE ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
--> statement-breakpoint
DROP TRIGGER reset_changed_transaction_reconciliation;
--> statement-breakpoint
CREATE TRIGGER reset_changed_transaction_reconciliation AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE transactions SET reconciled_status='unreconciled',reconciled_at=NULL,reconciled_statement_id=NULL WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER review_changed_statement_account;
--> statement-breakpoint
CREATE TRIGGER review_changed_statement_account AFTER UPDATE OF opening_balance,opening_date,type,currency ON accounts
WHEN (NEW.opening_balance IS NOT OLD.opening_balance OR NEW.opening_date IS NOT OLD.opening_date OR NEW.type IS NOT OLD.type OR NEW.currency IS NOT OLD.currency)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND completed_at IS NOT NULL; END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_delete AFTER DELETE ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_insert AFTER INSERT ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_update AFTER UPDATE OF account_id,date,security_id,qty,price,amount ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_delete AFTER DELETE ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_insert AFTER INSERT ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_update AFTER UPDATE OF account_id,date,amount ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_kind;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_kind AFTER UPDATE OF kind ON securities
WHEN NEW.kind IS NOT OLD.kind AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.owner_id=NEW.owner_id AND account_statements.completed_at IS NOT NULL AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.id AND h.date<=account_statements.period_end)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_delete AFTER DELETE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_insert AFTER INSERT ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_update AFTER UPDATE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.currency IS NOT OLD.currency OR NEW.price IS NOT OLD.price)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_delete AFTER DELETE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_insert AFTER INSERT ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_update AFTER UPDATE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.numerator IS NOT OLD.numerator OR NEW.denominator IS NOT OLD.denominator)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_delete AFTER DELETE ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_insert AFTER INSERT ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_update AFTER UPDATE OF account_id,date,security_id,qty,price,cash_amount,fee,activity,sequence ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.cash_amount IS NOT OLD.cash_amount OR NEW.fee IS NOT OLD.fee OR NEW.activity IS NOT OLD.activity OR NEW.sequence IS NOT OLD.sequence)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_delete AFTER DELETE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_insert AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_update AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_delete AFTER DELETE ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_insert AFTER INSERT ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_update AFTER UPDATE OF account_id,date,amount ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_unmarked_statement_transaction;
--> statement-breakpoint
CREATE TRIGGER review_unmarked_statement_transaction AFTER UPDATE OF reconciled_status ON transactions
WHEN OLD.reconciled_status='reconciled' AND NEW.reconciled_status!='reconciled' AND OLD.reconciled_statement_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=OLD.owner_id AND id=OLD.reconciled_statement_id AND completed_at IS NOT NULL; END;
--> statement-breakpoint
DROP TRIGGER loan_replay_statement_review;
--> statement-breakpoint
CREATE TRIGGER loan_replay_statement_review AFTER UPDATE OF loan_replay,loan_terms ON accounts WHEN (NEW.loan_replay IS NOT OLD.loan_replay OR (NEW.loan_terms IS NOT OLD.loan_terms AND (OLD.loan_replay=1 OR NEW.loan_replay=1))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23)) BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND completed_at IS NOT NULL; END;

--> statement-breakpoint
CREATE TRIGGER transfer_rejection_guard_delete BEFORE DELETE ON transfer_match_rejections WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
