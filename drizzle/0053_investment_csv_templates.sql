CREATE TABLE `investment_csv_templates` (
	`owner_id` text NOT NULL,
	`scope` text NOT NULL,
	`kind` text NOT NULL,
	`account_id` text,
	`template_json` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `profiles`(`owner_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`account_id`) REFERENCES `accounts`(`owner_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "investment_csv_template_json" CHECK(json_valid("investment_csv_templates"."template_json") AND json_type("investment_csv_templates"."template_json")='object' AND length("investment_csv_templates"."template_json")<=40000),
	CONSTRAINT "investment_csv_template_kind" CHECK(("investment_csv_templates"."kind"='prices' AND "investment_csv_templates"."account_id" IS NULL AND "investment_csv_templates"."scope"='prices') OR ("investment_csv_templates"."kind" IN ('trades','holdings') AND "investment_csv_templates"."account_id" IS NOT NULL AND "investment_csv_templates"."scope"="investment_csv_templates"."account_id"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_csv_template_scope` ON `investment_csv_templates` (`owner_id`,`scope`,`kind`);
--> statement-breakpoint
CREATE TRIGGER investment_csv_template_insert BEFORE INSERT ON investment_csv_templates
WHEN NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch=6)
 OR (NEW.kind!='prices' AND NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND type IN ('investment','crypto') AND archived=0))
BEGIN SELECT RAISE(ABORT,'investment_csv_template_invalid'); END;
--> statement-breakpoint
CREATE TRIGGER investment_csv_template_update BEFORE UPDATE ON investment_csv_templates
WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.scope IS NOT OLD.scope OR NEW.kind IS NOT OLD.kind OR NEW.account_id IS NOT OLD.account_id
 OR NOT EXISTS(SELECT 1 FROM workspace_guards WHERE owner_id=NEW.owner_id AND client_epoch=6)
 OR (NEW.kind!='prices' AND NOT EXISTS(SELECT 1 FROM accounts WHERE owner_id=NEW.owner_id AND id=NEW.account_id AND type IN ('investment','crypto') AND archived=0))
BEGIN SELECT RAISE(ABORT,'investment_csv_template_invalid'); END;
