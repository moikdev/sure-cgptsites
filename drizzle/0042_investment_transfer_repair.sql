-- Reporting-only maintenance preserves reconciliation evidence, while statement review remains active.
DROP TRIGGER reset_changed_transaction_reconciliation;
--> statement-breakpoint
CREATE TRIGGER reset_changed_transaction_reconciliation AFTER UPDATE OF account_id,date,amount,kind ON transactions
WHEN (NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.kind IS NOT OLD.kind)
 AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch IN (3,5,7,9,11,13,15,17,19,21,23,25,29,33))
 AND NOT (NEW.account_id IS OLD.account_id AND NEW.date IS OLD.date AND NEW.amount IS OLD.amount AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch=36))
BEGIN UPDATE transactions SET reconciled_status='unreconciled',reconciled_at=NULL,reconciled_statement_id=NULL WHERE owner_id=NEW.owner_id AND id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER investment_repair_footprint BEFORE UPDATE ON transactions
WHEN EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=36) AND
 (NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.account_id IS NOT OLD.account_id OR NEW.date IS NOT OLD.date OR NEW.amount IS NOT OLD.amount OR NEW.transfer_id IS NOT OLD.transfer_id OR NEW.category_id IS NOT OLD.category_id OR NEW.name IS NOT OLD.name OR NEW.notes IS NOT OLD.notes OR NEW.import_key IS NOT OLD.import_key OR NEW.excluded IS NOT OLD.excluded OR NEW.merchant_id IS NOT OLD.merchant_id OR NEW.tag_ids IS NOT OLD.tag_ids OR NEW.locked_fields IS NOT OLD.locked_fields OR NEW.reconciled_status IS NOT OLD.reconciled_status OR NEW.reconciled_at IS NOT OLD.reconciled_at OR NEW.reconciled_statement_id IS NOT OLD.reconciled_statement_id)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
--> statement-breakpoint
CREATE TRIGGER investment_repair_eligibility BEFORE UPDATE OF kind ON transactions
WHEN NEW.kind IS NOT OLD.kind AND EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch=36) AND
 (OLD.kind NOT IN ('funds_movement','cc_payment','loan_payment','investment_contribution') OR OLD.excluded!=0 OR EXISTS(SELECT 1 FROM json_each(OLD.locked_fields) WHERE value='kind') OR NOT EXISTS(
 SELECT 1 FROM transactions incoming JOIN accounts destination ON destination.owner_id=incoming.owner_id AND destination.id=incoming.account_id JOIN accounts source ON source.owner_id=OLD.owner_id AND source.id=OLD.account_id
 WHERE incoming.owner_id=OLD.owner_id AND incoming.transfer_id=OLD.transfer_id AND incoming.amount>0 AND destination.type IN ('investment','crypto')
 AND NEW.kind=CASE WHEN OLD.amount>0 OR source.type IN ('investment','crypto') THEN 'funds_movement' ELSE 'investment_contribution' END
 ))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
