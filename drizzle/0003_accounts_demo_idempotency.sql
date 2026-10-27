CREATE TABLE `idempotency_keys` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`transaction_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idempotency_user_key_uq` ON `idempotency_keys` (`user_id`,`key`);--> statement-breakpoint
ALTER TABLE `accounts` ADD `is_demo` integer DEFAULT false NOT NULL;