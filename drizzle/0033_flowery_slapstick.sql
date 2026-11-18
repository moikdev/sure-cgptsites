CREATE TABLE `recurring_match_rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`recurring_entry_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`split_line_id` text,
	FOREIGN KEY (`owner_id`,`recurring_entry_id`) REFERENCES `recurring_entries`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`split_line_id`) REFERENCES `split_lines`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_match_rejections_pair` ON `recurring_match_rejections` (`owner_id`,`recurring_entry_id`,`transaction_id`,`split_line_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_match_rejections_root` ON `recurring_match_rejections` (`owner_id`,`recurring_entry_id`,`transaction_id`) WHERE "recurring_match_rejections"."split_line_id" IS NULL;--> statement-breakpoint
ALTER TABLE `recurring_allocations` ADD `match_confidence` integer;--> statement-breakpoint
ALTER TABLE `recurring_allocations` ADD `match_signals` text;--> statement-breakpoint
ALTER TABLE `recurring_entries` ADD `matching` text;--> statement-breakpoint
CREATE UNIQUE INDEX `split_lines_owner_id` ON `split_lines` (`owner_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER matcher_old_restore BEFORE INSERT ON workspace_guards
WHEN NEW.client_epoch IN (3,5,7,9,11) AND (
 EXISTS(SELECT 1 FROM recurring_entries WHERE owner_id=NEW.owner_id AND matching IS NOT NULL) OR
 EXISTS(SELECT 1 FROM recurring_allocations WHERE owner_id=NEW.owner_id AND (match_confidence IS NOT NULL OR match_signals IS NOT NULL)) OR
 EXISTS(SELECT 1 FROM recurring_match_rejections WHERE owner_id=NEW.owner_id))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_series_old_update BEFORE UPDATE OF matching,name ON recurring_entries
WHEN (NEW.matching IS NOT OLD.matching OR NEW.name IS NOT OLD.name) AND (NEW.matching IS NOT NULL OR OLD.matching IS NOT NULL)
 AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch<12)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_series_old_delete BEFORE DELETE ON recurring_entries
WHEN OLD.matching IS NOT NULL AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch<12)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_series_json_insert BEFORE INSERT ON recurring_entries
WHEN NEW.matching IS NOT NULL AND (NOT json_valid(NEW.matching) OR json_type(NEW.matching)!='object' OR length(NEW.matching)>300000)
BEGIN SELECT RAISE(ABORT,'invalid_matching_settings'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_allocation_evidence_insert BEFORE INSERT ON recurring_allocations
WHEN (NEW.match_confidence IS NOT NULL AND (typeof(NEW.match_confidence)!='integer' OR NEW.match_confidence NOT BETWEEN 0 AND 10000)) OR
 (NEW.match_signals IS NOT NULL AND (NOT json_valid(NEW.match_signals) OR json_type(NEW.match_signals)!='object' OR length(NEW.match_signals)>256000))
BEGIN SELECT RAISE(ABORT,'invalid_matching_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_series_json_update BEFORE UPDATE ON recurring_entries
WHEN NEW.matching IS NOT NULL AND (NOT json_valid(NEW.matching) OR json_type(NEW.matching)!='object' OR length(NEW.matching)>300000)
BEGIN SELECT RAISE(ABORT,'invalid_matching_settings'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_allocation_evidence_update BEFORE UPDATE ON recurring_allocations
WHEN (NEW.match_confidence IS NOT NULL AND (typeof(NEW.match_confidence)!='integer' OR NEW.match_confidence NOT BETWEEN 0 AND 10000)) OR
 (NEW.match_signals IS NOT NULL AND (NOT json_valid(NEW.match_signals) OR json_type(NEW.match_signals)!='object' OR length(NEW.match_signals)>256000))
BEGIN SELECT RAISE(ABORT,'invalid_matching_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_allocation_old_update BEFORE UPDATE OF match_confidence,match_signals ON recurring_allocations
WHEN (NEW.match_confidence IS NOT OLD.match_confidence OR NEW.match_signals IS NOT OLD.match_signals) AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch<12)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_rejection_insert BEFORE INSERT ON recurring_match_rejections
WHEN (SELECT count(*) FROM recurring_match_rejections WHERE owner_id=NEW.owner_id)>=10000 OR
 (NEW.split_line_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM split_lines WHERE owner_id=NEW.owner_id AND id=NEW.split_line_id AND transaction_id=NEW.transaction_id))
BEGIN SELECT RAISE(ABORT,'invalid_match_rejection'); END;
--> statement-breakpoint
CREATE TRIGGER matcher_rejection_immutable BEFORE UPDATE ON recurring_match_rejections
BEGIN SELECT RAISE(ABORT,'immutable_match_rejection'); END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_match_rejections_insert AFTER INSERT ON recurring_match_rejections
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_match_rejections_update AFTER UPDATE ON recurring_match_rejections
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_recurring_match_rejections_delete AFTER DELETE ON recurring_match_rejections
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER matcher_capacity_recurring_allocations_insert AFTER INSERT ON recurring_allocations
BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT a.*,t.amount AS root_amount,acc.currency AS native_currency,l.amount AS split_amount
 FROM recurring_allocations a JOIN recurring_occurrences o ON o.owner_id=a.owner_id AND o.id=a.occurrence_id
 JOIN recurring_entries e ON e.owner_id=o.owner_id AND e.id=o.recurring_entry_id
 JOIN transactions t ON t.owner_id=a.owner_id AND t.id=a.transaction_id
 JOIN accounts acc ON acc.owner_id=t.owner_id AND acc.id=t.account_id
 LEFT JOIN split_lines l ON l.owner_id=a.owner_id AND l.id=a.split_line_id AND l.transaction_id=a.transaction_id
 WHERE a.owner_id=NEW.owner_id AND a.transaction_id=NEW.transaction_id AND e.status!='ended' ) WHERE split_line_id IS NOT NULL AND split_amount IS NULL) THEN RAISE(ABORT,'payment_split_source') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT a.*,t.amount AS root_amount,acc.currency AS native_currency,l.amount AS split_amount
 FROM recurring_allocations a JOIN recurring_occurrences o ON o.owner_id=a.owner_id AND o.id=a.occurrence_id
 JOIN recurring_entries e ON e.owner_id=o.owner_id AND e.id=o.recurring_entry_id
 JOIN transactions t ON t.owner_id=a.owner_id AND t.id=a.transaction_id
 JOIN accounts acc ON acc.owner_id=t.owner_id AND acc.id=t.account_id
 LEFT JOIN split_lines l ON l.owner_id=a.owner_id AND l.id=a.split_line_id AND l.transaction_id=a.transaction_id
 WHERE a.owner_id=NEW.owner_id AND a.transaction_id=NEW.transaction_id AND e.status!='ended' ) GROUP BY transaction_id HAVING count(split_line_id)>0 AND count(split_line_id)<count(*)) THEN RAISE(ABORT,'payment_capacity_mixed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT a.*,t.amount AS root_amount,acc.currency AS native_currency,l.amount AS split_amount
 FROM recurring_allocations a JOIN recurring_occurrences o ON o.owner_id=a.owner_id AND o.id=a.occurrence_id
 JOIN recurring_entries e ON e.owner_id=o.owner_id AND e.id=o.recurring_entry_id
 JOIN transactions t ON t.owner_id=a.owner_id AND t.id=a.transaction_id
 JOIN accounts acc ON acc.owner_id=t.owner_id AND acc.id=t.account_id
 LEFT JOIN split_lines l ON l.owner_id=a.owner_id AND l.id=a.split_line_id AND l.transaction_id=a.transaction_id
 WHERE a.owner_id=NEW.owner_id AND a.transaction_id=NEW.transaction_id AND e.status!='ended' ) GROUP BY transaction_id,coalesce(split_line_id,'') HAVING
  sum(CASE WHEN source_amount>0 AND source_currency=native_currency THEN source_amount WHEN currency=native_currency THEN amount ELSE 0 END)>abs(coalesce(split_amount,root_amount)) OR
  (sum(CASE WHEN (source_amount>0 AND source_currency=native_currency) OR currency=native_currency THEN 0 ELSE 1 END)>0 AND count(*)>1)) THEN RAISE(ABORT,'payment_capacity') END; END;
--> statement-breakpoint
CREATE TRIGGER matcher_capacity_recurring_allocations_update AFTER UPDATE ON recurring_allocations
BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT a.*,t.amount AS root_amount,acc.currency AS native_currency,l.amount AS split_amount
 FROM recurring_allocations a JOIN recurring_occurrences o ON o.owner_id=a.owner_id AND o.id=a.occurrence_id
 JOIN recurring_entries e ON e.owner_id=o.owner_id AND e.id=o.recurring_entry_id
 JOIN transactions t ON t.owner_id=a.owner_id AND t.id=a.transaction_id
 JOIN accounts acc ON acc.owner_id=t.owner_id AND acc.id=t.account_id
 LEFT JOIN split_lines l ON l.owner_id=a.owner_id AND l.id=a.split_line_id AND l.transaction_id=a.transaction_id
 WHERE a.owner_id=NEW.owner_id AND a.transaction_id=NEW.transaction_id AND e.status!='ended' ) WHERE split_line_id IS NOT NULL AND split_amount IS NULL) THEN RAISE(ABORT,'payment_split_source') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT a.*,t.amount AS root_amount,acc.currency AS native_currency,l.amount AS split_amount
 FROM recurring_allocations a JOIN recurring_occurrences o ON o.owner_id=a.owner_id AND o.id=a.occurrence_id
 JOIN recurring_entries e ON e.owner_id=o.owner_id AND e.id=o.recurring_entry_id
 JOIN transactions t ON t.owner_id=a.owner_id AND t.id=a.transaction_id
 JOIN accounts acc ON acc.owner_id=t.owner_id AND acc.id=t.account_id
 LEFT JOIN split_lines l ON l.owner_id=a.owner_id AND l.id=a.split_line_id AND l.transaction_id=a.transaction_id
 WHERE a.owner_id=NEW.owner_id AND a.transaction_id=NEW.transaction_id AND e.status!='ended' ) GROUP BY transaction_id HAVING count(split_line_id)>0 AND count(split_line_id)<count(*)) THEN RAISE(ABORT,'payment_capacity_mixed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT a.*,t.amount AS root_amount,acc.currency AS native_currency,l.amount AS split_amount
 FROM recurring_allocations a JOIN recurring_occurrences o ON o.owner_id=a.owner_id AND o.id=a.occurrence_id
 JOIN recurring_entries e ON e.owner_id=o.owner_id AND e.id=o.recurring_entry_id
 JOIN transactions t ON t.owner_id=a.owner_id AND t.id=a.transaction_id
 JOIN accounts acc ON acc.owner_id=t.owner_id AND acc.id=t.account_id
 LEFT JOIN split_lines l ON l.owner_id=a.owner_id AND l.id=a.split_line_id AND l.transaction_id=a.transaction_id
 WHERE a.owner_id=NEW.owner_id AND a.transaction_id=NEW.transaction_id AND e.status!='ended' ) GROUP BY transaction_id,coalesce(split_line_id,'') HAVING
  sum(CASE WHEN source_amount>0 AND source_currency=native_currency THEN source_amount WHEN currency=native_currency THEN amount ELSE 0 END)>abs(coalesce(split_amount,root_amount)) OR
  (sum(CASE WHEN (source_amount>0 AND source_currency=native_currency) OR currency=native_currency THEN 0 ELSE 1 END)>0 AND count(*)>1)) THEN RAISE(ABORT,'payment_capacity') END; END;
--> statement-breakpoint
CREATE TRIGGER matcher_capacity_recurring_entries_update AFTER UPDATE OF status ON recurring_entries
BEGIN SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT a.*,t.amount AS root_amount,acc.currency AS native_currency,l.amount AS split_amount
 FROM recurring_allocations a JOIN recurring_occurrences o ON o.owner_id=a.owner_id AND o.id=a.occurrence_id
 JOIN recurring_entries e ON e.owner_id=o.owner_id AND e.id=o.recurring_entry_id
 JOIN transactions t ON t.owner_id=a.owner_id AND t.id=a.transaction_id
 JOIN accounts acc ON acc.owner_id=t.owner_id AND acc.id=t.account_id
 LEFT JOIN split_lines l ON l.owner_id=a.owner_id AND l.id=a.split_line_id AND l.transaction_id=a.transaction_id
 WHERE a.owner_id=NEW.owner_id AND e.status!='ended' ) WHERE split_line_id IS NOT NULL AND split_amount IS NULL) THEN RAISE(ABORT,'payment_split_source') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT a.*,t.amount AS root_amount,acc.currency AS native_currency,l.amount AS split_amount
 FROM recurring_allocations a JOIN recurring_occurrences o ON o.owner_id=a.owner_id AND o.id=a.occurrence_id
 JOIN recurring_entries e ON e.owner_id=o.owner_id AND e.id=o.recurring_entry_id
 JOIN transactions t ON t.owner_id=a.owner_id AND t.id=a.transaction_id
 JOIN accounts acc ON acc.owner_id=t.owner_id AND acc.id=t.account_id
 LEFT JOIN split_lines l ON l.owner_id=a.owner_id AND l.id=a.split_line_id AND l.transaction_id=a.transaction_id
 WHERE a.owner_id=NEW.owner_id AND e.status!='ended' ) GROUP BY transaction_id HAVING count(split_line_id)>0 AND count(split_line_id)<count(*)) THEN RAISE(ABORT,'payment_capacity_mixed') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM (SELECT a.*,t.amount AS root_amount,acc.currency AS native_currency,l.amount AS split_amount
 FROM recurring_allocations a JOIN recurring_occurrences o ON o.owner_id=a.owner_id AND o.id=a.occurrence_id
 JOIN recurring_entries e ON e.owner_id=o.owner_id AND e.id=o.recurring_entry_id
 JOIN transactions t ON t.owner_id=a.owner_id AND t.id=a.transaction_id
 JOIN accounts acc ON acc.owner_id=t.owner_id AND acc.id=t.account_id
 LEFT JOIN split_lines l ON l.owner_id=a.owner_id AND l.id=a.split_line_id AND l.transaction_id=a.transaction_id
 WHERE a.owner_id=NEW.owner_id AND e.status!='ended' ) GROUP BY transaction_id,coalesce(split_line_id,'') HAVING
  sum(CASE WHEN source_amount>0 AND source_currency=native_currency THEN source_amount WHEN currency=native_currency THEN amount ELSE 0 END)>abs(coalesce(split_amount,root_amount)) OR
  (sum(CASE WHEN (source_amount>0 AND source_currency=native_currency) OR currency=native_currency THEN 0 ELSE 1 END)>0 AND count(*)>1)) THEN RAISE(ABORT,'payment_capacity') END; END;
--> statement-breakpoint
DROP TRIGGER reset_changed_transaction_reconciliation;
--> statement-breakpoint
CREATE TRIGGER reset_changed_transaction_reconciliation AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE transactions SET reconciled_status='unreconciled',reconciled_at=NULL,reconciled_statement_id=NULL WHERE owner_id=NEW.owner_id AND id=NEW.id; END;

--> statement-breakpoint
DROP TRIGGER review_unmarked_statement_transaction;
--> statement-breakpoint
CREATE TRIGGER review_unmarked_statement_transaction AFTER UPDATE OF reconciled_status ON transactions
WHEN OLD.reconciled_status='reconciled' AND NEW.reconciled_status!='reconciled' AND OLD.reconciled_statement_id IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=OLD.owner_id AND id=OLD.reconciled_statement_id AND completed_at IS NOT NULL; END;

--> statement-breakpoint
DROP TRIGGER review_changed_statement_account;
--> statement-breakpoint
CREATE TRIGGER review_changed_statement_account AFTER UPDATE OF opening_balance,opening_date,type,currency ON accounts
WHEN (NEW.opening_balance IS NOT OLD.opening_balance OR NEW.opening_date IS NOT OLD.opening_date OR NEW.type IS NOT OLD.type OR NEW.currency IS NOT OLD.currency)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND completed_at IS NOT NULL; END;

--> statement-breakpoint
DROP TRIGGER review_statement_transactions_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_insert AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_transactions_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_update AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_transactions_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_transactions_delete AFTER DELETE ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_valuations_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_insert AFTER INSERT ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_valuations_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_update AFTER UPDATE OF account_id,date,amount ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_valuations_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_valuations_delete AFTER DELETE ON valuations
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_insert AFTER INSERT ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_update AFTER UPDATE OF account_id,date,amount ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_investment_cash_balances_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_investment_cash_balances_delete AFTER DELETE ON investment_cash_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_trades_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_insert AFTER INSERT ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_trades_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_update AFTER UPDATE OF account_id,date,security_id,qty,price,cash_amount,fee,activity,sequence ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.cash_amount IS NOT OLD.cash_amount OR NEW.fee IS NOT OLD.fee OR NEW.activity IS NOT OLD.activity OR NEW.sequence IS NOT OLD.sequence)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_trades_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_trades_delete AFTER DELETE ON trades
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_insert AFTER INSERT ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_update AFTER UPDATE OF account_id,date,security_id,qty,price,amount ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13)) AND (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.security_id IS NOT OLD.security_id OR NEW.qty IS NOT OLD.qty OR NEW.price IS NOT OLD.price OR NEW.amount IS NOT OLD.amount)
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=NEW.owner_id AND account_id=NEW.account_id AND period_end>=NEW.date) OR (owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_holding_snapshots_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_holding_snapshots_delete AFTER DELETE ON holding_snapshots
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE completed_at IS NOT NULL AND ((owner_id=OLD.owner_id AND account_id=OLD.account_id AND period_end>=OLD.date)); END;

--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_insert AFTER INSERT ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;

--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_update AFTER UPDATE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.currency IS NOT OLD.currency OR NEW.price IS NOT OLD.price)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;

--> statement-breakpoint
DROP TRIGGER review_statement_security_prices_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_prices_delete AFTER DELETE ON security_prices
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;

--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_insert;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_insert AFTER INSERT ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end)))); END;

--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_update;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_update AFTER UPDATE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13)) AND (NEW.security_id IS NOT OLD.security_id OR NEW.date IS NOT OLD.date OR NEW.numerator IS NOT OLD.numerator OR NEW.denominator IS NOT OLD.denominator)
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=NEW.owner_id AND account_statements.period_end>=NEW.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.security_id AND h.date<=account_statements.period_end))) OR (account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;

--> statement-breakpoint
DROP TRIGGER review_statement_security_splits_delete;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_splits_delete AFTER DELETE ON security_splits
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.completed_at IS NOT NULL AND ((account_statements.owner_id=OLD.owner_id AND account_statements.period_end>=OLD.date AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=OLD.security_id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=OLD.security_id AND h.date<=account_statements.period_end)))); END;

--> statement-breakpoint
DROP TRIGGER review_statement_security_kind;
--> statement-breakpoint
CREATE TRIGGER review_statement_security_kind AFTER UPDATE OF kind ON securities
WHEN NEW.kind IS NOT OLD.kind AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13))
BEGIN UPDATE account_statements SET review_required=1 WHERE account_statements.owner_id=NEW.owner_id AND account_statements.completed_at IS NOT NULL AND (EXISTS (SELECT 1 FROM trades t WHERE t.owner_id=account_statements.owner_id AND t.account_id=account_statements.account_id AND t.security_id=NEW.id AND t.date<=account_statements.period_end) OR EXISTS (SELECT 1 FROM holding_snapshots h WHERE h.owner_id=account_statements.owner_id AND h.account_id=account_statements.account_id AND h.security_id=NEW.id AND h.date<=account_statements.period_end)); END;


--> statement-breakpoint
DROP TRIGGER lock_manual_transactions_updates;
--> statement-breakpoint
CREATE TRIGGER lock_manual_transactions_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch!=12)
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;

--> statement-breakpoint
DROP TRIGGER lock_manual_split_lines_updates;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_lines_updates AFTER UPDATE OF name,category_id,merchant_id,tag_ids,excluded ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch!=12)
BEGIN UPDATE split_lines SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(NEW.locked_fields,'$[#]',CASE WHEN NEW.name IS NOT OLD.name THEN 'name' END,'$[#]',CASE WHEN NEW.category_id IS NOT OLD.category_id THEN 'categoryId' END,'$[#]',CASE WHEN NEW.merchant_id IS NOT OLD.merchant_id THEN 'merchantId' END,'$[#]',CASE WHEN NEW.tag_ids IS NOT OLD.tag_ids THEN 'tagIds' END,'$[#]',CASE WHEN NEW.excluded IS NOT OLD.excluded THEN 'excluded' END)) WHERE value IS NOT NULL)) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;

--> statement-breakpoint
DROP TRIGGER lock_manual_transaction_inserts;
--> statement-breakpoint
CREATE TRIGGER lock_manual_transaction_inserts AFTER INSERT ON transactions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch!=12)
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM json_each(json_array('name',CASE WHEN NEW.category_id IS NOT NULL THEN 'categoryId' END,CASE WHEN NEW.merchant_id IS NOT NULL THEN 'merchantId' END,CASE WHEN json_array_length(NEW.tag_ids)>0 THEN 'tagIds' END,CASE WHEN NEW.excluded!=0 THEN 'excluded' END)) WHERE value IS NOT NULL) WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
DROP TRIGGER lock_manual_split_inserts;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_inserts AFTER INSERT ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=2 AND client_epoch!=12)
BEGIN
 UPDATE split_lines SET locked_fields='["name","categoryId","merchantId","tagIds","excluded"]' WHERE owner_id=NEW.owner_id AND id=NEW.id;
 UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=NEW.owner_id AND id=NEW.transaction_id;
END;
--> statement-breakpoint
DROP TRIGGER lock_manual_split_deletes;
--> statement-breakpoint
CREATE TRIGGER lock_manual_split_deletes AFTER DELETE ON split_lines
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=2 AND client_epoch!=12)
BEGIN UPDATE transactions SET locked_fields=(SELECT json_group_array(value) FROM (SELECT DISTINCT value FROM json_each(json_insert(locked_fields,'$[#]','split')))) WHERE owner_id=OLD.owner_id AND id=OLD.transaction_id; END;
