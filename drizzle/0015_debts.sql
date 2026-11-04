CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`name_key` text NOT NULL,
	`trusted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_name_uq` ON `contacts` (`user_id`,`name_key`);--> statement-breakpoint
CREATE TABLE `debt_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`debt_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`date` text NOT NULL,
	`account_id` text,
	`txn_id` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`debt_id`) REFERENCES `debts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "debt_payments_amount_positive" CHECK("debt_payments"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `debt_payments_debt_idx` ON `debt_payments` (`debt_id`);--> statement-breakpoint
CREATE TABLE `debts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`direction` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`date` text NOT NULL,
	`due_date` text,
	`note` text,
	`account_id` text,
	`txn_id` text,
	`status` text DEFAULT 'open' NOT NULL,
	`settled_at` text,
	`forgiven` integer DEFAULT false NOT NULL,
	`last_followup_on` text,
	`follow_up_stopped` integer DEFAULT false NOT NULL,
	`remind_stage` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "debts_amount_positive" CHECK("debts"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `debts_user_status_idx` ON `debts` (`user_id`,`status`);