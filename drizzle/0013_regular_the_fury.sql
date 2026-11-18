CREATE TABLE `budget_books` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`currency` text NOT NULL,
	`start_day` integer DEFAULT 1 NOT NULL,
	`account_mode` text DEFAULT 'all' NOT NULL,
	`account_ids` text DEFAULT '[]' NOT NULL,
	`source_kind` text DEFAULT 'custom' NOT NULL,
	`source_reference` text,
	`legacy_compat` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_month_start" CHECK("budget_books"."start_day" BETWEEN 1 AND 28)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_books_owner_id` ON `budget_books` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_books_legacy_currency` ON `budget_books` (`owner_id`,`currency`) WHERE "budget_books"."legacy_compat"=1;--> statement-breakpoint
CREATE TABLE `budget_envelopes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`period_id` text NOT NULL,
	`category_id` text NOT NULL,
	`allocated` integer NOT NULL,
	`rollover_enabled` integer DEFAULT 0 NOT NULL,
	`imported_carry` integer,
	FOREIGN KEY (`owner_id`,`period_id`) REFERENCES `budget_periods`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`,`category_id`) REFERENCES `categories`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_envelope_amounts" CHECK("budget_envelopes"."allocated" BETWEEN 0 AND 9007199254740991 AND ("budget_envelopes"."imported_carry" IS NULL OR "budget_envelopes"."imported_carry" BETWEEN 0 AND 9007199254740991))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_envelopes_owner_period_category` ON `budget_envelopes` (`owner_id`,`period_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `budget_periods` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`book_id` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`currency` text NOT NULL,
	`budgeted_spending` integer,
	`expected_income` integer,
	`auto_total` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`owner_id`,`book_id`) REFERENCES `budget_books`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "budget_period_amounts" CHECK(("budget_periods"."budgeted_spending" IS NULL OR "budget_periods"."budgeted_spending" BETWEEN 0 AND 9007199254740991) AND ("budget_periods"."expected_income" IS NULL OR "budget_periods"."expected_income" BETWEEN 0 AND 9007199254740991))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budget_periods_owner_id` ON `budget_periods` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `budget_periods_owner_book_dates` ON `budget_periods` (`owner_id`,`book_id`,`start_date`,`end_date`);--> statement-breakpoint
ALTER TABLE `workspace_guards` ADD `client_epoch` integer DEFAULT 0 NOT NULL;