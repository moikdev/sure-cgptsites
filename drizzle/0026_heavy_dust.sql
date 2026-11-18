ALTER TABLE `recurring_allocations` ADD `conversion` text;--> statement-breakpoint
ALTER TABLE `recurring_allocations` ADD `request_fingerprint` text;
--> statement-breakpoint
CREATE TRIGGER protect_payment_history_currency BEFORE UPDATE OF currency,opening_date ON accounts
WHEN EXISTS (SELECT 1 FROM recurring_allocations a WHERE a.owner_id=OLD.owner_id AND a.conversion IS NOT NULL AND json_extract(a.conversion,'$.accountId')=OLD.id AND (NEW.currency IS NOT OLD.currency OR NEW.opening_date>json_extract(a.conversion,'$.sourceDate')))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER protect_payment_history_account BEFORE DELETE ON accounts
WHEN EXISTS (SELECT 1 FROM recurring_allocations a WHERE a.owner_id=OLD.owner_id AND a.conversion IS NOT NULL AND json_extract(a.conversion,'$.accountId')=OLD.id)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER protect_payment_conversion_transaction BEFORE UPDATE OF amount,account_id,date ON transactions
WHEN (NEW.amount IS NOT OLD.amount OR NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date)
 AND EXISTS (SELECT 1 FROM recurring_allocations WHERE owner_id=OLD.owner_id AND transaction_id=OLD.id AND conversion IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER protect_payment_conversion_split BEFORE UPDATE OF amount ON split_lines
WHEN NEW.amount IS NOT OLD.amount AND EXISTS (SELECT 1 FROM recurring_allocations WHERE owner_id=OLD.owner_id AND split_line_id=OLD.id AND conversion IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER unlink_payment_split_before_delete BEFORE DELETE ON split_lines
BEGIN UPDATE recurring_allocations SET transaction_id=NULL,split_line_id=NULL WHERE owner_id=OLD.owner_id AND split_line_id=OLD.id; END;
