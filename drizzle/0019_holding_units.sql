CREATE TABLE `holding_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`holding_id` text NOT NULL,
	`date` text NOT NULL,
	`units_e4` integer NOT NULL,
	`cost_paise` integer NOT NULL,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holding_lots_positive" CHECK("holding_lots"."units_e4" > 0 AND "holding_lots"."cost_paise" >= 0)
);
--> statement-breakpoint
CREATE INDEX `holding_lots_holding_idx` ON `holding_lots` (`holding_id`);--> statement-breakpoint
ALTER TABLE `holding_values` ADD `rate_paise` integer;--> statement-breakpoint
ALTER TABLE `holdings` ADD `tracking` text DEFAULT 'value' NOT NULL;--> statement-breakpoint
ALTER TABLE `holdings` ADD `opening_units_e4` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `transactions` ADD `units_e4` integer;