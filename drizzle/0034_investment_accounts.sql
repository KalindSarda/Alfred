CREATE TABLE `investment_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`purpose` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `investment_accounts_user_name_uq` ON `investment_accounts` (`user_id`,`name`);--> statement-breakpoint
ALTER TABLE `holdings` ADD `investment_account_id` text;