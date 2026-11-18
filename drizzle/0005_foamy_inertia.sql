CREATE TABLE `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`website_url` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchants_owner_id` ON `merchants` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `recurring_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`occurrence_id` text NOT NULL,
	`transaction_id` text,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`source_amount` integer,
	`source_currency` text,
	`state` text NOT NULL,
	`source` text NOT NULL,
	`paid_on` text,
	FOREIGN KEY (`owner_id`,`occurrence_id`) REFERENCES `recurring_occurrences`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "allocation_amount_range" CHECK("recurring_allocations"."amount" > 0 AND "recurring_allocations"."amount" <= 1000000000000)
);
--> statement-breakpoint
CREATE TABLE `recurring_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`account_id` text,
	`destination_account_id` text,
	`category_id` text,
	`merchant_id` text,
	`tag_ids` text DEFAULT '[]' NOT NULL,
	`amount` integer NOT NULL,
	`currency` text NOT NULL,
	`bill_type` text NOT NULL,
	`status` text NOT NULL,
	`anchor_date` text NOT NULL,
	`expected_day_of_month` integer NOT NULL,
	`rules` text DEFAULT '[]' NOT NULL,
	`end_mode` text NOT NULL,
	`end_on` text,
	`end_after_count` integer,
	`weekend_adjust` text NOT NULL,
	`amount_strategy` text NOT NULL,
	`expected_amount_min` integer,
	`expected_amount_max` integer,
	`expected_amount_avg` integer,
	`notify_days_before` integer NOT NULL,
	`overdue_grace_days` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`payment_url` text,
	`autopay` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`destination_account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`category_id`) REFERENCES `categories`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`merchant_id`) REFERENCES `merchants`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_amount_range" CHECK(abs("recurring_entries"."amount") <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_entries_owner_id` ON `recurring_entries` (`owner_id`,`id`);--> statement-breakpoint
CREATE TABLE `recurring_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`recurring_entry_id` text NOT NULL,
	`original_due_on` text NOT NULL,
	`due_on` text NOT NULL,
	`currency` text NOT NULL,
	`expected_amount` integer,
	`status` text NOT NULL,
	`snoozed_until` text,
	`closed_at` text,
	`closed_source` text,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`owner_id`,`recurring_entry_id`) REFERENCES `recurring_entries`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_occurrences_owner_id` ON `recurring_occurrences` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_occurrence_identity` ON `recurring_occurrences` (`owner_id`,`recurring_entry_id`,`original_due_on`);--> statement-breakpoint
CREATE TABLE `split_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`category_id` text,
	`merchant_id` text,
	`tag_ids` text DEFAULT '[]' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'standard' NOT NULL,
	`excluded` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`category_id`) REFERENCES `categories`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`merchant_id`) REFERENCES `merchants`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "split_amount_range" CHECK("split_lines"."amount" != 0 AND abs("split_lines"."amount") <= 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `split_line_position` ON `split_lines` (`owner_id`,`transaction_id`,`position`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_owner_id` ON `tags` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tags_owner_name` ON `tags` (`owner_id`,`name`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `merchant_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `tag_ids` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `transactions_owner_id` ON `transactions` (`owner_id`,`id`);