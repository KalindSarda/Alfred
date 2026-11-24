CREATE TABLE `price_links` (
	`holding_id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`feed` text NOT NULL,
	`code` text NOT NULL,
	`label` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `app_settings` ADD `price_refresh` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `prices_checked_at` text;--> statement-breakpoint
ALTER TABLE `holding_kinds` ADD `feed` text;--> statement-breakpoint
ALTER TABLE `holding_kinds` ADD `feed_adjust_bp` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `holding_values` ADD `source` text DEFAULT 'typed' NOT NULL;