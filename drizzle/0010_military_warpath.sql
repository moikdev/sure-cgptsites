CREATE TABLE `holding_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`qty` text NOT NULL,
	`price` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`cost_basis` text,
	`cost_basis_source` text,
	`cost_basis_locked` integer DEFAULT 0 NOT NULL,
	`security_locked` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`security_id`) REFERENCES `securities`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holding_amount_range" CHECK(abs("holding_snapshots"."amount") <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holdings_owner_account_security_date` ON `holding_snapshots` (`owner_id`,`account_id`,`security_id`,`date`);--> statement-breakpoint
CREATE TABLE `investment_cash_balances` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "investment_cash_range" CHECK(abs("investment_cash_balances"."amount") <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_cash_owner_account_date` ON `investment_cash_balances` (`owner_id`,`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `securities` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`ticker` text NOT NULL,
	`name` text NOT NULL,
	`exchange` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'standard' NOT NULL,
	`website_url` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `securities_owner_id` ON `securities` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `securities_owner_ticker_exchange` ON `securities` (`owner_id`,`ticker`,`exchange`);--> statement-breakpoint
CREATE TABLE `security_prices` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`currency` text NOT NULL,
	`price` text NOT NULL,
	FOREIGN KEY (`owner_id`,`security_id`) REFERENCES `securities`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `security_prices_owner_security_date_currency` ON `security_prices` (`owner_id`,`security_id`,`date`,`currency`);--> statement-breakpoint
CREATE TABLE `security_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`numerator` integer NOT NULL,
	`denominator` integer NOT NULL,
	FOREIGN KEY (`owner_id`,`security_id`) REFERENCES `securities`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "security_split_ratio" CHECK("security_splits"."numerator" > 0 AND "security_splits"."denominator" > 0 AND "security_splits"."numerator" != "security_splits"."denominator")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `splits_owner_security_date` ON `security_splits` (`owner_id`,`security_id`,`date`);--> statement-breakpoint
CREATE TABLE `trades` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`security_id` text NOT NULL,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`qty` text NOT NULL,
	`price` text NOT NULL,
	`fee` integer NOT NULL,
	`cash_amount` integer NOT NULL,
	`currency` text NOT NULL,
	`activity` text NOT NULL,
	`sequence` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`security_id`) REFERENCES `securities`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "trade_amount_range" CHECK(abs("trades"."cash_amount") <= 1000000000000 AND "trades"."fee" >= 0 AND "trades"."fee" <= 1000000000000)
);
--> statement-breakpoint
CREATE INDEX `trades_owner_account_date` ON `trades` (`owner_id`,`account_id`,`date`);