CREATE TABLE account_details (
 owner_id text NOT NULL,
 account_id text NOT NULL,
 subtype text,
 crypto_tax_treatment text,
 FOREIGN KEY(owner_id,account_id) REFERENCES accounts(owner_id,id) ON DELETE CASCADE,
 CONSTRAINT account_details_nonempty CHECK(subtype IS NOT NULL OR crypto_tax_treatment IS NOT NULL),
 CONSTRAINT account_subtype_text CHECK(subtype IS NULL OR (length(subtype) BETWEEN 1 AND 80 AND subtype=trim(subtype) AND instr(subtype,char(0))=0 AND subtype NOT GLOB '*['||char(1)||'-'||char(31)||char(127)||']*')),
 CONSTRAINT account_crypto_tax CHECK(crypto_tax_treatment IS NULL OR crypto_tax_treatment IN ('taxable','tax_deferred','tax_exempt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX account_details_owner_account ON account_details(owner_id,account_id);
--> statement-breakpoint
CREATE TRIGGER account_details_insert_parent BEFORE INSERT ON account_details WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND (NEW.crypto_tax_treatment IS NULL OR type='crypto')) BEGIN SELECT RAISE(ABORT,'account_details_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER account_details_update_parent BEFORE UPDATE ON account_details WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.account_id IS NOT OLD.account_id OR NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND (NEW.crypto_tax_treatment IS NULL OR type='crypto')) BEGIN SELECT RAISE(ABORT,'account_details_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER account_details_type_change AFTER UPDATE OF type ON accounts WHEN NEW.type IS NOT OLD.type AND NOT (NEW.type IN ('checking','savings') AND OLD.type IN ('checking','savings')) BEGIN DELETE FROM account_details WHERE owner_id=NEW.owner_id AND account_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER account_details_revision_insert AFTER INSERT ON account_details WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER account_details_revision_update AFTER UPDATE ON account_details WHEN (NEW.subtype IS NOT OLD.subtype OR NEW.crypto_tax_treatment IS NOT OLD.crypto_tax_treatment) AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER account_details_revision_delete AFTER DELETE ON account_details WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
