CREATE TABLE `goal_pledges` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`account_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`matched_transaction_id` text,
	`matched_valuation_id` text,
	`matched_date` text,
	`matched_amount` integer,
	`matched_at` text,
	`matched_source_name` text,
	`matched_prior_balance` integer,
	`matched_new_balance` integer,
	FOREIGN KEY (`owner_id`,`goal_id`) REFERENCES `goals`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`matched_transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`matched_valuation_id`) REFERENCES `valuations`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pledge_amount" CHECK("goal_pledges"."amount" BETWEEN 1 AND 1000000000000 AND ("goal_pledges"."matched_amount" IS NULL OR "goal_pledges"."matched_amount" BETWEEN 1 AND 2000000000000)),
	CONSTRAINT "pledge_enum" CHECK("goal_pledges"."status" IN ('open','matched','cancelled','expired') AND "goal_pledges"."kind" IN ('transfer','manual_save'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pledges_owner_transaction` ON `goal_pledges` (`owner_id`,`matched_transaction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pledges_owner_valuation` ON `goal_pledges` (`owner_id`,`matched_valuation_id`);--> statement-breakpoint
CREATE INDEX `pledges_owner_open_account` ON `goal_pledges` (`owner_id`,`status`,`account_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `valuations_owner_id` ON `valuations` (`owner_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER track_goal_pledges_insert AFTER INSERT ON goal_pledges
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_goal_pledges_update AFTER UPDATE ON goal_pledges
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_goal_pledges_delete AFTER DELETE ON goal_pledges
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER goal_pledge_limit BEFORE INSERT ON goal_pledges
WHEN (SELECT COUNT(*) FROM goal_pledges WHERE owner_id=NEW.owner_id)>=5000
BEGIN SELECT RAISE(ABORT,'pledge_limit'); END;
--> statement-breakpoint
CREATE TRIGGER goal_pledge_duplicate BEFORE INSERT ON goal_pledges
WHEN NEW.status='open' AND EXISTS (SELECT 1 FROM goal_pledges WHERE owner_id=NEW.owner_id AND goal_id=NEW.goal_id AND account_id=NEW.account_id AND amount=NEW.amount AND status='open' AND expires_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now'))
BEGIN SELECT RAISE(ABORT,'duplicate_open_pledge'); END;
--> statement-breakpoint
CREATE TRIGGER unlink_deleted_pledge_transaction BEFORE DELETE ON transactions
BEGIN UPDATE goal_pledges SET matched_transaction_id=NULL WHERE owner_id=OLD.owner_id AND matched_transaction_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER unlink_deleted_pledge_valuation BEFORE DELETE ON valuations
BEGIN UPDATE goal_pledges SET matched_valuation_id=NULL WHERE owner_id=OLD.owner_id AND matched_valuation_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER cancel_released_goal_pledges AFTER UPDATE OF state ON goals
WHEN NEW.state IN ('completed','archived')
BEGIN UPDATE goal_pledges SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id=NEW.owner_id AND goal_id=NEW.id AND status='open'; END;
--> statement-breakpoint
CREATE TRIGGER cancel_unlinked_goal_pledges AFTER DELETE ON goal_accounts
BEGIN UPDATE goal_pledges SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id=OLD.owner_id AND goal_id=OLD.goal_id AND account_id=OLD.account_id AND status='open'; END;
--> statement-breakpoint
CREATE TRIGGER cancel_incompatible_account_pledges AFTER UPDATE OF type,currency ON accounts
BEGIN UPDATE goal_pledges SET status='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id=NEW.owner_id AND account_id=NEW.id AND status='open' AND (currency!=NEW.currency OR NEW.type NOT IN ('checking','savings','investment','crypto') OR (kind='manual_save' AND NEW.type NOT IN ('checking','savings'))); END;
