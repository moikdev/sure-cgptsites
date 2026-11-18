CREATE TABLE `exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`from_currency` text NOT NULL,
	`to_currency` text NOT NULL,
	`rate` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rate_pair" CHECK("exchange_rates"."from_currency"!="exchange_rates"."to_currency"),
	CONSTRAINT "rate_positive" CHECK(length("exchange_rates"."rate")<=52 AND CAST("exchange_rates"."rate" AS REAL)>0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rates_owner_pair_date` ON `exchange_rates` (`owner_id`,`from_currency`,`to_currency`,`date`);--> statement-breakpoint
CREATE TABLE `transfer_details` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`date` text NOT NULL,
	`destination_date` text NOT NULL,
	`from_currency` text NOT NULL,
	`to_currency` text NOT NULL,
	`from_amount` integer NOT NULL,
	`to_amount` integer NOT NULL,
	`rate_numerator` text NOT NULL,
	`rate_denominator` text NOT NULL,
	`rate_date` text,
	`rate_source` text NOT NULL,
	`source_fee` integer DEFAULT 0 NOT NULL,
	`destination_fee` integer DEFAULT 0 NOT NULL,
	`request_id` text,
	`request_fingerprint` text,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfer_detail_amounts" CHECK("transfer_details"."from_amount" BETWEEN 1 AND 1000000000000 AND "transfer_details"."to_amount" BETWEEN 1 AND 1000000000000 AND "transfer_details"."source_fee" BETWEEN 0 AND 1000000000000 AND "transfer_details"."destination_fee" BETWEEN 0 AND 1000000000000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_details_owner_id` ON `transfer_details` (`owner_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_details_request` ON `transfer_details` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE TABLE `transfer_fees` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`transfer_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`side` text NOT NULL,
	FOREIGN KEY (`owner_id`,`transfer_id`) REFERENCES `transfer_details`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`transaction_id`) REFERENCES `transactions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transfer_fee_side" CHECK("transfer_fees"."side" IN ('source','destination'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_fees_side` ON `transfer_fees` (`owner_id`,`transfer_id`,`side`);--> statement-breakpoint
CREATE UNIQUE INDEX `transfer_fees_transaction` ON `transfer_fees` (`owner_id`,`transaction_id`);
--> statement-breakpoint
CREATE TRIGGER track_exchange_rates_insert AFTER INSERT ON exchange_rates
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_exchange_rates_update AFTER UPDATE ON exchange_rates
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_exchange_rates_delete AFTER DELETE ON exchange_rates
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transfer_details_insert AFTER INSERT ON transfer_details
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transfer_details_update AFTER UPDATE ON transfer_details
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transfer_details_delete AFTER DELETE ON transfer_details
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transfer_fees_insert AFTER INSERT ON transfer_fees
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transfer_fees_update AFTER UPDATE ON transfer_fees
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=NEW.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER track_transfer_fees_delete AFTER DELETE ON transfer_fees
WHEN NOT EXISTS (SELECT 1 FROM workspace_guards WHERE owner_id=OLD.owner_id)
BEGIN UPDATE profiles SET revision=revision+1 WHERE owner_id=OLD.owner_id; END;

--> statement-breakpoint
CREATE TRIGGER exchange_rate_limit BEFORE INSERT ON exchange_rates
WHEN (SELECT COUNT(*) FROM exchange_rates WHERE owner_id=NEW.owner_id)>=20000
BEGIN SELECT RAISE(ABORT,'exchange_rate_limit'); END;
