CREATE TABLE `csv_import_templates` (
	`owner_id` text NOT NULL,
	`account_id` text NOT NULL,
	`template_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "csv_template_json" CHECK(json_valid("csv_import_templates"."template_json") AND length("csv_import_templates"."template_json")<=40000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `csv_templates_owner_account` ON `csv_import_templates` (`owner_id`,`account_id`);