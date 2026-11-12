CREATE TABLE `fire_plan` (
	`user_id` text PRIMARY KEY NOT NULL,
	`age_now` integer,
	`target_age` integer,
	`monthly_spend_paise` integer,
	`withdrawal_rate_bp` integer DEFAULT 350 NOT NULL,
	`inflation_bp` integer DEFAULT 600 NOT NULL,
	`return_bp` integer DEFAULT 1000 NOT NULL,
	`monthly_saving_paise` integer,
	`stepup_bp` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `holdings` ADD `counts_for_fire` integer DEFAULT true NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `holding_kinds` (`id`, `user_id`, `key`, `name`, `unit`, `rate_per`, `is_system`, `created_at`)
SELECT lower(hex(randomblob(13))), u.`id`, 'retirement', 'Retirement (EPF, PPF, NPS)', NULL, 1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `users` u;
