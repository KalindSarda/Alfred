CREATE TABLE `holds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`title` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`applied_date` text NOT NULL,
	`expected_date` text,
	`status` text DEFAULT 'active' NOT NULL,
	`resolved_at` text,
	`resolved_txn_id` text,
	`reminded_on` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holds_amount_positive" CHECK("holds"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `holds_user_status_idx` ON `holds` (`user_id`,`status`);