CREATE TABLE `holding_contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`holding_id` text NOT NULL,
	`date` text NOT NULL,
	`own_paise` integer DEFAULT 0 NOT NULL,
	`employer_paise` integer DEFAULT 0 NOT NULL,
	`link_id` text,
	`link_role` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`holding_id`) REFERENCES `holdings`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "holding_contributions_amounts" CHECK("holding_contributions"."own_paise" >= 0 AND "holding_contributions"."employer_paise" >= 0 AND "holding_contributions"."own_paise" + "holding_contributions"."employer_paise" > 0)
);
--> statement-breakpoint
CREATE INDEX `holding_contributions_holding_idx` ON `holding_contributions` (`holding_id`);--> statement-breakpoint
CREATE INDEX `holding_contributions_link_idx` ON `holding_contributions` (`link_id`);