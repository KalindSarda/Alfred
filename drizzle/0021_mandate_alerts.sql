CREATE TABLE `mandate_alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`due_date` text NOT NULL,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mandate_alerts_uq` ON `mandate_alerts` (`user_id`,`key`,`due_date`);