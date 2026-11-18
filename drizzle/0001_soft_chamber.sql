CREATE TABLE `valuations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text NOT NULL,
	`amount` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "valuation_amount_range" CHECK(abs("valuations"."amount") <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `valuations_owner_account_date` ON `valuations` (`owner_id`,`account_id`,`date`);--> statement-breakpoint
CREATE TABLE `workspace_guards` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`expected_revision` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `categories` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `excluded` integer DEFAULT 0 NOT NULL;