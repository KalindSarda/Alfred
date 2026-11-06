CREATE TABLE `holding_kinds` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`unit` text,
	`rate_per` integer DEFAULT 1 NOT NULL,
	`is_system` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holding_kinds_rate_per" CHECK("holding_kinds"."rate_per" IN (1, 10, 100, 1000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holding_kinds_user_key_uq` ON `holding_kinds` (`user_id`,`key`);--> statement-breakpoint
INSERT INTO `holding_kinds` (`id`, `user_id`, `key`, `name`, `unit`, `rate_per`, `is_system`, `created_at`)
SELECT lower(hex(randomblob(13))), u.`id`, k.`key`, k.`name`, k.`unit`, k.`rate_per`, k.`is_system`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `users` u
CROSS JOIN (
  SELECT 'stock' AS `key`, 'Stock or IPO' AS `name`, 'shares' AS `unit`, 1 AS `rate_per`, 1 AS `is_system`
  UNION ALL SELECT 'fund', 'Mutual fund', 'units', 1, 0
  UNION ALL SELECT 'gold', 'Gold', 'g', 10, 0
  UNION ALL SELECT 'crypto', 'Crypto', NULL, 1, 0
  UNION ALL SELECT 'other', 'Other', NULL, 1, 1
) k;
