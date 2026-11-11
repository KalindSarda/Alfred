CREATE TABLE `salary_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`txn_id` text NOT NULL,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `salary_log_uq` ON `salary_log` (`user_id`,`txn_id`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `morning_push` integer DEFAULT false NOT NULL;