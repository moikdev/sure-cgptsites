CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text NOT NULL,
	`opening_balance` integer NOT NULL,
	`opening_date` text NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "account_balance_range" CHECK(abs("accounts"."opening_balance") <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_owner_id` ON `accounts` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`category_id` text NOT NULL,
	`month` text NOT NULL,
	`currency` text NOT NULL,
	`amount` integer NOT NULL,
	FOREIGN KEY (`owner_id`,`category_id`) REFERENCES `categories`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_amount_range" CHECK("budgets"."amount" > 0 AND "budgets"."amount" <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_owner_month_category` ON `budgets` (`owner_id`,`month`,`currency`,`category_id`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_owner_id` ON `categories` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `categories_owner_name` ON `categories` (`owner_id`,`name`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`date` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`kind` text NOT NULL,
	`transfer_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`import_key` text,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`category_id`) REFERENCES `categories`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transaction_amount_range" CHECK("transactions"."amount" != 0 AND abs("transactions"."amount") <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_import_key` ON `transactions` (`owner_id`,`account_id`,`import_key`);--> statement-breakpoint
CREATE INDEX `transactions_owner_date` ON `transactions` (`owner_id`,`date`);--> statement-breakpoint
CREATE INDEX `transactions_transfer` ON `transactions` (`owner_id`,`transfer_id`);