PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recurring_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`account_id` text,
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
	`holding_id` text,
	`own_paise` integer DEFAULT 0 NOT NULL,
	`employer_paise` integer DEFAULT 0 NOT NULL,
	`pension_paise` integer DEFAULT 0 NOT NULL,
	`pension_holding_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_amount_positive" CHECK("__new_recurring_rules"."amount_paise" > 0),
	CONSTRAINT "recurring_day_range" CHECK("__new_recurring_rules"."day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
INSERT INTO `__new_recurring_rules`("id", "user_id", "title", "type", "amount_paise", "account_id", "category_id", "frequency", "day", "month", "start_date", "end_date", "mode", "remind_days_before", "last_reminded_for", "skips_json", "paused_at", "holding_id", "created_at") SELECT "id", "user_id", "title", "type", "amount_paise", "account_id", "category_id", "frequency", "day", "month", "start_date", "end_date", "mode", "remind_days_before", "last_reminded_for", "skips_json", "paused_at", "holding_id", "created_at" FROM `recurring_rules`;--> statement-breakpoint
DROP TABLE `recurring_rules`;--> statement-breakpoint
ALTER TABLE `__new_recurring_rules` RENAME TO `recurring_rules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `recurring_rules_user_idx` ON `recurring_rules` (`user_id`);--> statement-breakpoint
ALTER TABLE `holding_contributions` ADD `recurring_rule_id` text;--> statement-breakpoint
ALTER TABLE `holding_contributions` ADD `recurring_on` text;--> statement-breakpoint
CREATE UNIQUE INDEX `holding_contributions_recurring_uq` ON `holding_contributions` (`recurring_rule_id`,`recurring_on`);