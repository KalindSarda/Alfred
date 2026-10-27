CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`last4` text,
	`opening_balance_paise` integer DEFAULT 0 NOT NULL,
	`counts_toward_safe_to_spend` integer DEFAULT true NOT NULL,
	`credit_limit_paise` integer,
	`statement_day` integer,
	`due_day` integer,
	`opening_outstanding_paise` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_card_fields" CHECK("accounts"."kind" = 'bank' OR ("accounts"."credit_limit_paise" > 0 AND "accounts"."statement_day" BETWEEN 1 AND 31 AND "accounts"."due_day" BETWEEN 1 AND 31))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_name_uq` ON `accounts` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`nudge_lead_days` integer DEFAULT 3 NOT NULL,
	`nudge_time_ist` text DEFAULT '10:00' NOT NULL,
	`session_days` integer DEFAULT 30 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_user_kind_name_uq` ON `categories` (`user_id`,`kind`,`name`);--> statement-breakpoint
CREATE TABLE `merchant_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`alias` text NOT NULL,
	`merchant` text NOT NULL,
	`default_category_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`default_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `merchant_aliases_user_alias_uq` ON `merchant_aliases` (`user_id`,`alias`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`txn_date` text NOT NULL,
	`account_id` text NOT NULL,
	`to_account_id` text,
	`category_id` text,
	`merchant` text,
	`note` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "txn_amount_positive" CHECK("transactions"."amount_paise" > 0),
	CONSTRAINT "txn_transfer_shape" CHECK(("transactions"."type" = 'transfer' AND "transactions"."to_account_id" IS NOT NULL AND "transactions"."to_account_id" <> "transactions"."account_id" AND "transactions"."category_id" IS NULL) OR ("transactions"."type" <> 'transfer' AND "transactions"."to_account_id" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `txn_user_date_idx` ON `transactions` (`user_id`,`txn_date`,`id`);--> statement-breakpoint
CREATE INDEX `txn_user_account_date_idx` ON `transactions` (`user_id`,`account_id`,`txn_date`);--> statement-breakpoint
CREATE INDEX `txn_user_to_account_idx` ON `transactions` (`user_id`,`to_account_id`);--> statement-breakpoint
CREATE INDEX `txn_user_category_date_idx` ON `transactions` (`user_id`,`category_id`,`txn_date`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);