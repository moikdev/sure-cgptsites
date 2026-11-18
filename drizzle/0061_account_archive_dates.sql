CREATE TABLE account_archive_dates (
 owner_id text NOT NULL,
 account_id text NOT NULL,
 archived_on text NOT NULL,
 FOREIGN KEY(owner_id,account_id) REFERENCES accounts(owner_id,id) ON DELETE CASCADE,
 CONSTRAINT archive_date_calendar CHECK(length(archived_on)=10 AND archived_on BETWEEN '1900-01-01' AND '2199-12-31' AND archived_on GLOB '[12][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' AND date(archived_on,'+0 days') IS NOT NULL AND date(archived_on,'+0 days')=archived_on)
);
--> statement-breakpoint
CREATE UNIQUE INDEX account_archive_dates_owner_account ON account_archive_dates(owner_id,account_id);
--> statement-breakpoint
CREATE TRIGGER archive_date_insert_parent BEFORE INSERT ON account_archive_dates WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND archived=1) OR NEW.archived_on>date('now') BEGIN SELECT RAISE(ABORT,'archive_date_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER archive_date_update_parent BEFORE UPDATE ON account_archive_dates WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.account_id IS NOT OLD.account_id OR NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND archived=1) OR NEW.archived_on>date('now') BEGIN SELECT RAISE(ABORT,'archive_date_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER archive_date_record_transition AFTER UPDATE OF archived ON accounts WHEN OLD.archived=0 AND NEW.archived=1 AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND id GLOB 'category-restore:*') BEGIN INSERT INTO account_archive_dates(owner_id,account_id,archived_on) VALUES(NEW.owner_id,NEW.id,date('now')) ON CONFLICT(owner_id,account_id) DO UPDATE SET archived_on=excluded.archived_on; END;
--> statement-breakpoint
CREATE TRIGGER archive_date_clear_transition AFTER UPDATE OF archived ON accounts WHEN NEW.archived=0 BEGIN DELETE FROM account_archive_dates WHERE owner_id=NEW.owner_id AND account_id=NEW.id; END;
--> statement-breakpoint
CREATE TRIGGER archive_date_revision_insert AFTER INSERT ON account_archive_dates WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER archive_date_revision_update AFTER UPDATE ON account_archive_dates WHEN NEW.archived_on IS NOT OLD.archived_on AND NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER archive_date_revision_delete AFTER DELETE ON account_archive_dates WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id) BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
