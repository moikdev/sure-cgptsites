ALTER TABLE `accounts` ADD `loan_replay` integer;
--> statement-breakpoint
CREATE TRIGGER loan_replay_old_restore BEFORE INSERT ON workspace_guards WHEN NEW.client_epoch IN (3,5,7,9,11,13,15,17,19) AND EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND loan_replay IS NOT NULL) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_account_insert BEFORE INSERT ON accounts WHEN NEW.loan_replay IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_account_update BEFORE UPDATE ON accounts WHEN (OLD.loan_replay IS NOT NULL OR NEW.loan_replay IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_account_delete BEFORE DELETE ON accounts WHEN OLD.loan_replay IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_valid_insert BEFORE INSERT ON accounts WHEN NEW.loan_replay IS NOT NULL AND (typeof(NEW.loan_replay)!='integer' OR NEW.loan_replay NOT IN (0,1) OR NEW.type!='loan') BEGIN SELECT RAISE(ABORT,'invalid_loan_replay'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_valid_update BEFORE UPDATE ON accounts WHEN NEW.loan_replay IS NOT NULL AND (typeof(NEW.loan_replay)!='integer' OR NEW.loan_replay NOT IN (0,1) OR NEW.type!='loan') BEGIN SELECT RAISE(ABORT,'invalid_loan_replay'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_transaction_insert BEFORE INSERT ON transactions WHEN (EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND loan_replay=1) OR (NEW.transfer_id IS NOT NULL AND EXISTS(SELECT 1 FROM transactions t JOIN accounts a ON a.owner_id=t.owner_id AND a.id=t.account_id WHERE t.owner_id=NEW.owner_id AND t.transfer_id=NEW.transfer_id AND a.loan_replay=1))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_valuation_insert BEFORE INSERT ON valuations WHEN (EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND loan_replay=1)) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_transaction_update BEFORE UPDATE ON transactions WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.transfer_id IS NOT OLD.transfer_id) AND (EXISTS(SELECT 1 FROM accounts WHERE owner_id=OLD.owner_id AND id=OLD.account_id AND loan_replay=1) OR (OLD.transfer_id IS NOT NULL AND EXISTS(SELECT 1 FROM transactions t JOIN accounts a ON a.owner_id=t.owner_id AND a.id=t.account_id WHERE t.owner_id=OLD.owner_id AND t.transfer_id=OLD.transfer_id AND a.loan_replay=1)) OR EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND loan_replay=1) OR (NEW.transfer_id IS NOT NULL AND EXISTS(SELECT 1 FROM transactions t JOIN accounts a ON a.owner_id=t.owner_id AND a.id=t.account_id WHERE t.owner_id=NEW.owner_id AND t.transfer_id=NEW.transfer_id AND a.loan_replay=1))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_valuation_update BEFORE UPDATE ON valuations WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount) AND (EXISTS(SELECT 1 FROM accounts WHERE owner_id=OLD.owner_id AND id=OLD.account_id AND loan_replay=1) OR EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND loan_replay=1)) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_transaction_delete BEFORE DELETE ON transactions WHEN (EXISTS(SELECT 1 FROM accounts WHERE owner_id=OLD.owner_id AND id=OLD.account_id AND loan_replay=1) OR (OLD.transfer_id IS NOT NULL AND EXISTS(SELECT 1 FROM transactions t JOIN accounts a ON a.owner_id=t.owner_id AND a.id=t.account_id WHERE t.owner_id=OLD.owner_id AND t.transfer_id=OLD.transfer_id AND a.loan_replay=1))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_valuation_delete BEFORE DELETE ON valuations WHEN (EXISTS(SELECT 1 FROM accounts WHERE owner_id=OLD.owner_id AND id=OLD.account_id AND loan_replay=1)) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=20) BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
DROP TRIGGER lock_manual_split_deletes;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_deletes AFTER DELETE ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20))
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=OLD.owner_id AND id=OLD.transaction_id; END;
--> statement-breakpoint
DROP TRIGGER lock_manual_split_inserts;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_inserts AFTER INSERT ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20))
BEGIN
 UPDATE split_lines SET locked_fields='["name","categoryId","merchantId","tagIds","excluded"]' WHERE owner_id=NEW.owner_id AND id=NEW.id;
 UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=NEW.owner_id AND id=NEW.transaction_id;
END;
--> statement-breakpoint
DROP TRIGGER lock_manual_split_lines_updates;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_lines_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20))
BEGIN UPDATE split_lines SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER lock_manual_transaction_inserts;
--> statement-breakpoint
CREATE TRIGGER lock_manual_transaction_inserts AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20))
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM json_each(json_array('name',CASE WHEN NEW.category_id IS NOT NULL THEN 'categoryId' END,CASE WHEN NEW.merchant_id IS NOT NULL THEN 'merchantId' END,CASE WHEN json_array_length(NEW.tag_ids)>0 THEN 'tagIds' END,CASE WHEN NEW.excluded!=0 THEN 'excluded' END)) WHERE value IS NOT NULL) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER lock_manual_transactions_updates;
--> statement-breakpoint
CREATE TRIGGER lock_manual_transactions_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch NOT IN (12,16,18,20))
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER reset_changed_transaction_reconciliation;
--> statement-breakpoint
CREATE TRIGGER reset_changed_transaction_reconciliation AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE transactions SET reconciled_status='unreconciled',reconciled_at=NULL,reconciled_statement_id=NULL WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER review_changed_statement_account;
--> statement-breakpoint
CREATE TRIGGER review_changed_statement_account AFTER UPDATE OF opening_balance,opening_date,type,currency ON accounts
WHEN (NEW.opening_balance IS NOT OLD.opening_balance OR NEW.opening_date IS NOT OLD.opening_date OR NEW.type IS NOT OLD.type OR NEW.currency IS NOT OLD.currency)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND completed_at IS NOT NULL; END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_delete AFTER DELETE ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_insert AFTER INSERT ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_update AFTER UPDATE OF account_id,date,security_id,qty,price,amount ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_delete AFTER DELETE ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_insert AFTER INSERT ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_update AFTER UPDATE OF account_id,date,amount ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_kind;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_kind AFTER UPDATE OF kind ON securities
WHEN NEW.kind IS NOT OLD.kind AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.owner_id=NEW.owner_id AND account_statements.completed_at IS NOT NULL AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.id AND h.date<=account_statements.period_end)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_delete AFTER DELETE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_insert AFTER INSERT ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_update AFTER UPDATE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.currency IS NOT OLD.currency OR NEW.price IS NOT OLD.price)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_delete AFTER DELETE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_insert AFTER INSERT ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_update AFTER UPDATE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.numerator IS NOT OLD.numerator OR NEW.denominator IS NOT OLD.denominator)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_delete AFTER DELETE ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_insert AFTER INSERT ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_trades_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_update AFTER UPDATE OF account_id,date,security_id,qty,price,cash_amount,fee,activity,sequence ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.cash_amount IS NOT OLD.cash_amount OR NEW.fee IS NOT OLD.fee OR NEW.activity IS NOT OLD.activity OR NEW.sequence IS NOT OLD.sequence)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_delete AFTER DELETE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_insert AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_transactions_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_update AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_delete AFTER DELETE ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_insert AFTER INSERT ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;
--> statement-breakpoint
DROP TRIGGER review_statement_valuations_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_update AFTER UPDATE OF account_id,date,amount ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;
--> statement-breakpoint
DROP TRIGGER review_unmarked_statement_transaction;
--> statement-breakpoint
CREATE TRIGGER review_unmarked_statement_transaction AFTER UPDATE OF reconciled_status ON transactions
WHEN OLD.reconciled_status='reconciled' AND NEW.reconciled_status!='reconciled' AND OLD.reconciled_statement_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=OLD.owner_id AND id=OLD.reconciled_statement_id AND completed_at IS NOT NULL; END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_statement_review AFTER UPDATE OF loan_replay,loan_terms ON accounts WHEN (NEW.loan_replay IS NOT OLD.loan_replay OR (NEW.loan_terms IS NOT OLD.loan_terms AND (OLD.loan_replay=1 OR NEW.loan_replay=1))) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21)) BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND completed_at IS NOT NULL; END;

--> statement-breakpoint
CREATE TRIGGER loan_replay_eligible_insert BEFORE INSERT ON accounts WHEN NEW.loan_replay=1 AND CASE WHEN NEW.loan_terms IS NULL OR NOT json_valid(NEW.loan_terms) THEN 1 ELSE json_type(NEW.loan_terms,'$.initialBalance') IS NOT 'integer' OR json_extract(NEW.loan_terms,'$.initialBalance')<=0 OR NEW.opening_balance IS NOT -json_extract(NEW.loan_terms,'$.initialBalance') OR NEW.opening_date IS NOT json_extract(NEW.loan_terms,'$.startDate') OR json_type(NEW.loan_terms,'$.termMonths') IS NOT 'integer' OR json_extract(NEW.loan_terms,'$.termMonths') NOT BETWEEN 1 AND 1200 OR json_type(NEW.loan_terms,'$.annualRate') IS NOT 'text' OR json_type(NEW.loan_terms,'$.rateType') IS NOT 'text' OR length(json_extract(NEW.loan_terms,'$.rateType'))=0 END BEGIN SELECT RAISE(ABORT,'invalid_loan_replay_origination'); END;
--> statement-breakpoint
CREATE TRIGGER loan_replay_eligible_update BEFORE UPDATE ON accounts WHEN NEW.loan_replay=1 AND CASE WHEN NEW.loan_terms IS NULL OR NOT json_valid(NEW.loan_terms) THEN 1 ELSE json_type(NEW.loan_terms,'$.initialBalance') IS NOT 'integer' OR json_extract(NEW.loan_terms,'$.initialBalance')<=0 OR NEW.opening_balance IS NOT -json_extract(NEW.loan_terms,'$.initialBalance') OR NEW.opening_date IS NOT json_extract(NEW.loan_terms,'$.startDate') OR json_type(NEW.loan_terms,'$.termMonths') IS NOT 'integer' OR json_extract(NEW.loan_terms,'$.termMonths') NOT BETWEEN 1 AND 1200 OR json_type(NEW.loan_terms,'$.annualRate') IS NOT 'text' OR json_type(NEW.loan_terms,'$.rateType') IS NOT 'text' OR length(json_extract(NEW.loan_terms,'$.rateType'))=0 END BEGIN SELECT RAISE(ABORT,'invalid_loan_replay_origination'); END;
