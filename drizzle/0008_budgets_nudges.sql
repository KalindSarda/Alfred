CREATE TABLE `budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`category_id` text NOT NULL,
	`limit_paise` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budgets_limit_positive" CHECK("budgets"."limit_paise" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `budgets_user_category_uq` ON `budgets` (`user_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `nudge_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_account_id` text NOT NULL,
	`due_date` text NOT NULL,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nudge_log_card_due_uq` ON `nudge_log` (`user_id`,`card_account_id`,`due_date`);