CREATE TABLE `loans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`lender` text,
	`kind` text NOT NULL,
	`account_id` text NOT NULL,
	`due_day` integer NOT NULL,
	`principal_paise` integer NOT NULL,
	`anchor_date` text NOT NULL,
	`rate_pct_bp` integer NOT NULL,
	`emi_paise` integer NOT NULL,
	`first_due_date` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`closed_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "loans_principal_positive" CHECK("loans"."principal_paise" > 0),
	CONSTRAINT "loans_emi_positive" CHECK("loans"."emi_paise" > 0),
	CONSTRAINT "loans_due_day" CHECK("loans"."due_day" BETWEEN 1 AND 31)
);
--> statement-breakpoint
CREATE INDEX `loans_user_status_idx` ON `loans` (`user_id`,`status`);--> statement-breakpoint
ALTER TABLE `transactions` ADD `loan_id` text;--> statement-breakpoint
ALTER TABLE `transactions` ADD `loan_on` text;--> statement-breakpoint
CREATE UNIQUE INDEX `txn_loan_instalment_uq` ON `transactions` (`loan_id`,`loan_on`,`type`);