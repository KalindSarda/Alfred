CREATE TABLE `recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`account_id` text NOT NULL,
	`category_id` text,
	`frequency` text NOT NULL,
	`day` integer NOT NULL,
	`month` integer,
	`start_date` text NOT NULL,
	`end_date` text,
	`mode` text DEFAULT 'auto' NOT NULL,
	`remind_days_before` integer,
	`last_reminded_for` text,
	`skips_json` text,
	`paused_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_amount_positive" CHECK("recurring_rules"."amount_paise" > 0),
	CONSTRAINT "recurring_day_range" CHECK("recurring_rules"."day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE INDEX `recurring_rules_user_idx` ON `recurring_rules` (`user_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `recurring_rule_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `recurring_on` text;--> statement-breakpoint
CREATE UNIQUE INDEX `txn_recurring_occurrence_uq` ON `transactions` (`recurring_rule_id`,`recurring_on`);