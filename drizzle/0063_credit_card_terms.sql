CREATE TABLE credit_card_terms (
 owner_id text NOT NULL,account_id text NOT NULL,terms_json text NOT NULL,
 FOREIGN KEY(owner_id,account_id) REFERENCES accounts(owner_id,id) ON DELETE CASCADE,
 CONSTRAINT card_terms_json CHECK(json_valid(terms_json) AND json_type(terms_json)='object' AND length(terms_json)<=2000 AND
  coalesce(json_type(terms_json,'$.availableCredit'),'') IN ('null','integer') AND
  coalesce(json_type(terms_json,'$.minimumPayment'),'') IN ('null','integer') AND
  coalesce(json_type(terms_json,'$.annualFee'),'') IN ('null','integer') AND
  coalesce(json_type(terms_json,'$.apr'),'') IN ('null','text') AND
  coalesce(json_type(terms_json,'$.expirationDate'),'') IN ('null','text') AND
  coalesce(json_type(terms_json,'$.statementCloseDay'),'') IN ('null','integer') AND
  coalesce(json_type(terms_json,'$.dueDay'),'') IN ('null','integer') AND
  (json_type(terms_json,'$.availableCredit')='null' OR json_extract(terms_json,'$.availableCredit') BETWEEN 0 AND 1000000000000) AND
  (json_type(terms_json,'$.minimumPayment')='null' OR json_extract(terms_json,'$.minimumPayment') BETWEEN 0 AND 1000000000000) AND
  (json_type(terms_json,'$.annualFee')='null' OR json_extract(terms_json,'$.annualFee') BETWEEN 0 AND 1000000000000) AND
  (json_type(terms_json,'$.statementCloseDay')='null' OR json_extract(terms_json,'$.statementCloseDay') BETWEEN 1 AND 31) AND
  (json_type(terms_json,'$.dueDay')='null' OR json_extract(terms_json,'$.dueDay') BETWEEN 1 AND 31) AND
  (json_type(terms_json,'$.apr')='null' OR (json_extract(terms_json,'$.apr') GLOB '[0-9]*' AND json_extract(terms_json,'$.apr') NOT GLOB '*[^0-9.]*' AND length(json_extract(terms_json,'$.apr'))-length(replace(json_extract(terms_json,'$.apr'),'.',''))<=1 AND ((instr(json_extract(terms_json,'$.apr'),'.')=0 AND length(json_extract(terms_json,'$.apr')) BETWEEN 1 AND 8) OR (instr(json_extract(terms_json,'$.apr'),'.') BETWEEN 2 AND 9 AND length(json_extract(terms_json,'$.apr'))-instr(json_extract(terms_json,'$.apr'),'.') BETWEEN 1 AND 2 AND substr(json_extract(terms_json,'$.apr'),-1)!='0')) AND (json_extract(terms_json,'$.apr')='0' OR json_extract(terms_json,'$.apr') NOT LIKE '0%' OR json_extract(terms_json,'$.apr') LIKE '0.%'))) AND
  (json_type(terms_json,'$.expirationDate')='null' OR (length(json_extract(terms_json,'$.expirationDate'))=10 AND json_extract(terms_json,'$.expirationDate') BETWEEN '1900-01-01' AND '2199-12-31' AND json_extract(terms_json,'$.expirationDate') GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND date(json_extract(terms_json,'$.expirationDate'),'+0 days') IS NOT NULL AND date(json_extract(terms_json,'$.expirationDate'),'+0 days')=json_extract(terms_json,'$.expirationDate'))) AND
  (json_type(terms_json,'$.availableCredit')!='null' OR json_type(terms_json,'$.minimumPayment')!='null' OR json_type(terms_json,'$.annualFee')!='null' OR json_type(terms_json,'$.apr')!='null' OR json_type(terms_json,'$.expirationDate')!='null' OR json_type(terms_json,'$.statementCloseDay')!='null' OR json_type(terms_json,'$.dueDay')!='null'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX credit_card_terms_owner_account ON credit_card_terms(owner_id,account_id);
--> statement-breakpoint
CREATE TRIGGER card_terms_insert_parent BEFORE INSERT ON credit_card_terms WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND type='credit') OR (SELECT count(*) FROM json_each(NEW.terms_json))!=7 OR EXISTS(SELECT 1 FROM json_each(NEW.terms_json) WHERE key NOT IN ('availableCredit','minimumPayment','annualFee','apr','expirationDate','statementCloseDay','dueDay')) BEGIN SELECT RAISE(ABORT,'card_terms_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER card_terms_update_parent BEFORE UPDATE ON credit_card_terms WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.account_id IS NOT OLD.account_id OR NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND type='credit') OR (SELECT count(*) FROM json_each(NEW.terms_json))!=7 OR EXISTS(SELECT 1 FROM json_each(NEW.terms_json) WHERE key NOT IN ('availableCredit','minimumPayment','annualFee','apr','expirationDate','statementCloseDay','dueDay')) BEGIN SELECT RAISE(ABORT,'card_terms_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER card_terms_currency_change BEFORE UPDATE OF currency ON accounts WHEN NEW.type='credit' AND NEW.currency IS NOT OLD.currency AND EXISTS(SELECT 1 FROM credit_card_terms WHERE owner_id=OLD.owner_id AND account_id=OLD.id AND (json_type(terms_json,'$.availableCredit')!='null' OR json_type(terms_json,'$.minimumPayment')!='null' OR json_type(terms_json,'$.annualFee')!='null')) BEGIN SELECT RAISE(ABORT,'card_currency_locked'); END;
--> statement-breakpoint
CREATE TRIGGER card_terms_type_change AFTER UPDATE OF type ON accounts WHEN NEW.type!='credit' BEGIN DELETE FROM credit_card_terms WHERE owner_id=NEW.owner_id AND account_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER card_terms_revision_insert AFTER INSERT ON credit_card_terms WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER card_terms_revision_update AFTER UPDATE ON credit_card_terms WHEN NEW.terms_json IS NOT OLD.terms_json AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER card_terms_revision_delete AFTER DELETE ON credit_card_terms WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
--> statement-breakpoint
