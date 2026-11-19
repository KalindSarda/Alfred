CREATE TABLE `period_reserves` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`done_for` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "period_reserves_amount_positive" CHECK("period_reserves"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `period_reserves_user_idx` ON `period_reserves` (`user_id`);