CREATE TABLE `statement_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`card_account_id` text NOT NULL,
	`statement_date` text NOT NULL,
	`expected_paise` integer NOT NULL,
	`billed_paise` integer,
	`status` text DEFAULT 'asked' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`card_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `statement_checks_uq` ON `statement_checks` (`user_id`,`card_account_id`,`statement_date`);