ALTER TABLE `trades` ADD `import_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `trades_owner_account_import` ON `trades` (`owner_id`,`account_id`,`import_key`);