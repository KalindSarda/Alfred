CREATE TABLE `holding_partner_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`holding_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`kind` text NOT NULL,
	`date` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`txn_id` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`contact_id`) REFERENCES `contacts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holding_partner_amount_positive" CHECK("holding_partner_entries"."amount_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `holding_partner_holding_idx` ON `holding_partner_entries` (`holding_id`);--> statement-breakpoint
CREATE INDEX `holding_partner_contact_idx` ON `holding_partner_entries` (`contact_id`);