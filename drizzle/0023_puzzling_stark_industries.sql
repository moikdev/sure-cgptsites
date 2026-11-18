CREATE TABLE `contribution_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contribution_range" CHECK("contribution_balances"."amount" BETWEEN -9007199254740991 AND 9007199254740991),
	CONSTRAINT "contribution_source" CHECK("contribution_balances"."source" IN ('manual','sure_balance'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contributions_owner_account_date` ON `contribution_balances` (`owner_id`,`account_id`,`date`);--> statement-breakpoint
ALTER TABLE `goals` ADD `progress_basis` text DEFAULT 'balance' NOT NULL;
--> statement-breakpoint
CREATE TRIGGER track_contribution_balances_insert AFTER INSERT ON contribution_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_contribution_balances_update AFTER UPDATE ON contribution_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER track_contribution_balances_delete AFTER DELETE ON contribution_balances
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;
--> statement-breakpoint
CREATE TRIGGER goal_progress_basis_insert BEFORE INSERT ON goals
WHEN NEW.progress_basis NOT IN ('balance','contributions')
BEGIN SELECT RAISE(ABORT,'invalid_progress_basis'); END;
--> statement-breakpoint
CREATE TRIGGER goal_progress_basis_update BEFORE UPDATE OF progress_basis ON goals
WHEN NEW.progress_basis NOT IN ('balance','contributions')
BEGIN SELECT RAISE(ABORT,'invalid_progress_basis'); END;
--> statement-breakpoint
CREATE TRIGGER contribution_balance_limit BEFORE INSERT ON contribution_balances
WHEN (SELECT COUNT(*) FROM contribution_balances WHERE owner_id=NEW.owner_id)>=20000
BEGIN SELECT RAISE(ABORT,'contribution_balance_limit'); END;
