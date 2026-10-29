CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`invited_by` text NOT NULL,
	`created_at` text NOT NULL,
	`accepted_at` text,
	FOREIGN KEY (`invited_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_email_unique` ON `invites` (`email`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `onboarded_at` text;--> statement-breakpoint
ALTER TABLE `users` ADD `is_owner` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled_at` text;--> statement-breakpoint
UPDATE `users` SET `is_owner` = 1 WHERE `id` = (SELECT `id` FROM `users` ORDER BY `created_at` ASC, `id` ASC LIMIT 1);--> statement-breakpoint
UPDATE `app_settings` SET `onboarded_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `user_id` IN (SELECT DISTINCT `user_id` FROM `accounts`);
