INSERT INTO budget_books (id,owner_id,name,currency,start_day,account_mode,account_ids,source_kind,source_reference,legacy_compat)
SELECT lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),owner_id,currency||' budget',currency,1,'all','[]','household',NULL,1 FROM budgets GROUP BY owner_id,currency;
--> statement-breakpoint
INSERT INTO budget_periods (id,owner_id,book_id,start_date,end_date,currency,budgeted_spending,expected_income,auto_total)
SELECT lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6))),old.owner_id,book.id,old.month||'-01',date(old.month||'-01','+1 month','-1 day'),old.currency,CASE WHEN SUM(old.amount)<=9007199254740991 THEN SUM(old.amount) ELSE NULL END,NULL,1
FROM budgets old JOIN budget_books book ON book.owner_id=old.owner_id AND book.currency=old.currency AND book.legacy_compat=1 GROUP BY old.owner_id,old.month,old.currency;
--> statement-breakpoint
WITH RECURSIVE ancestry(owner_id,leaf_id,ancestor_id,depth) AS (
 SELECT owner_id,id,id,0 FROM categories
 UNION ALL
 SELECT a.owner_id,a.leaf_id,c.parent_id,a.depth+1 FROM ancestry a JOIN categories c ON c.owner_id=a.owner_id AND c.id=a.ancestor_id WHERE c.parent_id IS NOT NULL AND a.depth<10
), allocations AS (
 SELECT old.owner_id,old.month,old.currency,a.ancestor_id AS category_id,SUM(old.amount) AS allocated
 FROM budgets old JOIN ancestry a ON a.owner_id=old.owner_id AND a.leaf_id=old.category_id GROUP BY old.owner_id,old.month,old.currency,a.ancestor_id
)
INSERT INTO budget_envelopes (id,owner_id,period_id,category_id,allocated,rollover_enabled,imported_carry)
SELECT COALESCE((SELECT id FROM budgets old WHERE old.owner_id=a.owner_id AND old.month=a.month AND old.currency=a.currency AND old.category_id=a.category_id),lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-a'||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),a.owner_id,p.id,a.category_id,a.allocated,0,NULL
FROM allocations a JOIN budget_books b ON b.owner_id=a.owner_id AND b.currency=a.currency AND b.legacy_compat=1 JOIN budget_periods p ON p.owner_id=a.owner_id AND p.book_id=b.id AND p.start_date=a.month||'-01';
--> statement-breakpoint
UPDATE profiles SET revision=revision+1 WHERE owner_id IN (SELECT owner_id FROM budget_books);
--> statement-breakpoint
CREATE TRIGGER track_budget_books_insert
AFTER INSERT ON budget_books
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN
 UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budget_books_update
AFTER UPDATE ON budget_books
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN
 UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budget_books_delete
AFTER DELETE ON budget_books
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN
 UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budget_periods_insert
AFTER INSERT ON budget_periods
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN
 UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budget_periods_update
AFTER UPDATE ON budget_periods
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN
 UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budget_periods_delete
AFTER DELETE ON budget_periods
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN
 UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budget_envelopes_insert
AFTER INSERT ON budget_envelopes
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN
 UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budget_envelopes_update
AFTER UPDATE ON budget_envelopes
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN
 UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER track_budget_envelopes_delete
AFTER DELETE ON budget_envelopes
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN
 UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id;
END;
--> statement-breakpoint
CREATE TRIGGER protect_legacy_budgets_insert
BEFORE INSERT ON budgets
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=1)
BEGIN
 SELECT RAISE(ABORT,'workspace_changed');
END;
--> statement-breakpoint
CREATE TRIGGER protect_legacy_budgets_update
BEFORE UPDATE ON budgets
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=1)
BEGIN
 SELECT RAISE(ABORT,'workspace_changed');
END;
--> statement-breakpoint
CREATE TRIGGER protect_legacy_budgets_delete
BEFORE DELETE ON budgets
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id AND client_epoch>=1)
BEGIN
 SELECT RAISE(ABORT,'workspace_changed');
END;
--> statement-breakpoint
CREATE TRIGGER protect_budget_hierarchy_updates
BEFORE UPDATE OF parent_id ON categories
WHEN NEW.parent_id IS NOT OLD.parent_id AND NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch>=1)
BEGIN
 SELECT RAISE(ABORT,'workspace_changed');
END;
