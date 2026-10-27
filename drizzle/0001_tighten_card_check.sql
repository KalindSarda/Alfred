PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`last4` text,
	`opening_balance_paise` integer DEFAULT 0 NOT NULL,
	`counts_toward_safe_to_spend` integer DEFAULT true NOT NULL,
	`credit_limit_paise` integer,
	`statement_day` integer,
	`due_day` integer,
	`opening_outstanding_paise` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_card_fields" CHECK("__new_accounts"."kind" = 'bank' OR ("__new_accounts"."credit_limit_paise" IS NOT NULL AND "__new_accounts"."credit_limit_paise" > 0 AND "__new_accounts"."statement_day" IS NOT NULL AND "__new_accounts"."statement_day" BETWEEN 1 AND 31 AND "__new_accounts"."due_day" IS NOT NULL AND "__new_accounts"."due_day" BETWEEN 1 AND 31))
);
--> statement-breakpoint
INSERT INTO `__new_accounts`("id", "user_id", "kind", "name", "last4", "opening_balance_paise", "counts_toward_safe_to_spend", "credit_limit_paise", "statement_day", "due_day", "opening_outstanding_paise", "archived_at", "created_at") SELECT "id", "user_id", "kind", "name", "last4", "opening_balance_paise", "counts_toward_safe_to_spend", "credit_limit_paise", "statement_day", "due_day", "opening_outstanding_paise", "archived_at", "created_at" FROM `accounts`;--> statement-breakpoint
DROP TABLE `accounts`;--> statement-breakpoint
ALTER TABLE `__new_accounts` RENAME TO `accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_user_name_uq` ON `accounts` (`user_id`,`name`);