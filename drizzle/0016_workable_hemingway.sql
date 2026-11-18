CREATE TABLE `goal_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`account_id` text NOT NULL,
	`allocated_amount` integer,
	FOREIGN KEY (`owner_id`,`goal_id`) REFERENCES `goals`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goal_allocation_range" CHECK("goal_accounts"."allocated_amount" IS NULL OR "goal_accounts"."allocated_amount" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_accounts_owner_goal_account` ON `goal_accounts` (`owner_id`,`goal_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `goal_consumptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`account_id` text NOT NULL,
	`transaction_id` text,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`owner_id`,`goal_id`) REFERENCES `goals`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goal_consumption_range" CHECK("goal_consumptions"."amount" BETWEEN 1 AND 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goal_consumptions_transaction` ON `goal_consumptions` (`owner_id`,`transaction_id`);--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`target_amount` integer NOT NULL,
	`target_date` text,
	`kind` text DEFAULT 'one_off' NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`target_mode` text DEFAULT 'fixed' NOT NULL,
	`target_months` integer,
	`consumed_amount` integer DEFAULT 0 NOT NULL,
	`completed_amount` integer,
	`completed_at` text,
	`color` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "goal_amount_range" CHECK("goals"."target_amount" BETWEEN 1 AND 9007199254740991 AND "goals"."consumed_amount" BETWEEN 0 AND "goals"."target_amount" AND ("goals"."completed_amount" IS NULL OR "goals"."completed_amount" BETWEEN 0 AND 9007199254740991)),
	CONSTRAINT "goal_enum" CHECK("goals"."kind" IN ('one_off','maintained') AND "goals"."state" IN ('active','paused','completed','archived') AND "goals"."target_mode" IN ('fixed','months_of_expenses'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `goals_owner_id` ON `goals` (`owner_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER track_goals_insert AFTER INSERT ON goals
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_goals_update AFTER UPDATE ON goals
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_goals_delete AFTER DELETE ON goals
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_goal_accounts_insert AFTER INSERT ON goal_accounts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_goal_accounts_update AFTER UPDATE ON goal_accounts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_goal_accounts_delete AFTER DELETE ON goal_accounts
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_goal_consumptions_insert AFTER INSERT ON goal_consumptions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_goal_consumptions_update AFTER UPDATE ON goal_consumptions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_goal_consumptions_delete AFTER DELETE ON goal_consumptions
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER unlink_goal_transaction BEFORE DELETE ON transactions
BEGIN UPDATE goal_consumptions SET transaction_id=NULL WHERE owner_id=OLD.owner_id AND transaction_id=OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER protect_goal_account_currency BEFORE UPDATE OF currency,type ON accounts
WHEN (NEW.currency IS NOT OLD.currency OR NEW.type NOT IN ('checking','savings','investment','crypto'))
 AND EXISTS (SELECT 1 FROM goal_accounts WHERE owner_id=OLD.owner_id AND account_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;

--> statement-breakpoint
CREATE TRIGGER protect_goal_consumption_transaction BEFORE UPDATE OF amount,account_id,date,excluded,transfer_id ON transactions
WHEN EXISTS (SELECT 1 FROM goal_consumptions c WHERE c.owner_id=OLD.owner_id AND c.transaction_id=OLD.id
 AND (NEW.amount>=0 OR -NEW.amount<c.amount OR NEW.account_id IS NOT c.account_id OR NEW.date IS NOT c.date OR NEW.excluded!=0 OR NEW.transfer_id IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'workspace_changed'); END;
