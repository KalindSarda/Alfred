CREATE TABLE `checkin_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`day` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `checkin_log_uq` ON `checkin_log` (`user_id`,`kind`,`day`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `log_nudge` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `balance_check` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `log_nudge_until` text;