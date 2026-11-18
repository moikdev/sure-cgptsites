DROP INDEX `pledges_owner_valuation`;--> statement-breakpoint
ALTER TABLE `goal_pledges` ADD `matched_event_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `pledges_owner_event` ON `goal_pledges` (`owner_id`,`matched_event_id`);