CREATE TABLE `holding_values` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`holding_id` text NOT NULL,
	`date` text NOT NULL,
	`value_paise` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holding_values_nonnegative" CHECK("holding_values"."value_paise" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holding_values_day_uq` ON `holding_values` (`holding_id`,`date`);--> statement-breakpoint
CREATE TABLE `holdings` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`opening_invested_paise` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`closed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holdings_opening_nonnegative" CHECK("holdings"."opening_invested_paise" >= 0)
);
--> statement-breakpoint
CREATE INDEX `holdings_user_status_idx` ON `holdings` (`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `recurring_rules` ADD `holding_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `holding_id` text;--> statement-breakpoint
CREATE INDEX `txn_holding_idx` ON `transactions` (`holding_id`);