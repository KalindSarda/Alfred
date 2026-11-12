CREATE TABLE `insurance_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`source` text DEFAULT 'personal' NOT NULL,
	`insurer` text NOT NULL,
	`cover_paise` integer DEFAULT 0 NOT NULL,
	`premium_paise` integer DEFAULT 0 NOT NULL,
	`frequency` text DEFAULT 'yearly' NOT NULL,
	`renewal_date` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `insurance_user_idx` ON `insurance_policies` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `insurance_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`due_date` text NOT NULL,
	`sent_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `insurance_reminders_uq` ON `insurance_reminders` (`user_id`,`policy_id`,`due_date`);--> statement-breakpoint
CREATE TABLE `protection_profile` (
	`user_id` text PRIMARY KEY NOT NULL,
	`dependants` text DEFAULT 'unknown' NOT NULL,
	`employer_health` text DEFAULT 'unknown' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
