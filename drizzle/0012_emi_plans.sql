CREATE TABLE `emi_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_account_id` text NOT NULL,
	`title` text NOT NULL,
	`category_id` text,
	`total_paise` integer NOT NULL,
	`months` integer NOT NULL,
	`instalment_paise` integer NOT NULL,
	`start_month` text NOT NULL,
	`created_at` text NOT NULL,
	`cancelled_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "emi_total_positive" CHECK("emi_plans"."total_paise" > 0),
	CONSTRAINT "emi_instalment_positive" CHECK("emi_plans"."instalment_paise" > 0),
	CONSTRAINT "emi_months_range" CHECK("emi_plans"."months" BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE INDEX `emi_plans_user_idx` ON `emi_plans` (`user_id`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `emi_plan_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `emi_instalment` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `txn_emi_instalment_uq` ON `transactions` (`emi_plan_id`,`emi_instalment`);