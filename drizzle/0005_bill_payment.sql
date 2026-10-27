PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`txn_date` text NOT NULL,
	`account_id` text NOT NULL,
	`to_account_id` text,
	`category_id` text,
	`merchant` text,
	`note` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`source` text DEFAULT 'web' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "txn_amount_positive" CHECK("__new_transactions"."amount_paise" > 0),
	CONSTRAINT "txn_transfer_shape" CHECK(("__new_transactions"."type" IN ('transfer', 'bill_payment') AND "__new_transactions"."to_account_id" IS NOT NULL AND "__new_transactions"."to_account_id" <> "__new_transactions"."account_id" AND "__new_transactions"."category_id" IS NULL) OR ("__new_transactions"."type" NOT IN ('transfer', 'bill_payment') AND "__new_transactions"."to_account_id" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_transactions`("id", "user_id", "type", "amount_paise", "txn_date", "account_id", "to_account_id", "category_id", "merchant", "note", "status", "source", "created_at", "updated_at", "deleted_at") SELECT "id", "user_id", "type", "amount_paise", "txn_date", "account_id", "to_account_id", "category_id", "merchant", "note", "status", "source", "created_at", "updated_at", "deleted_at" FROM `transactions`;--> statement-breakpoint
DROP TABLE `transactions`;--> statement-breakpoint
ALTER TABLE `__new_transactions` RENAME TO `transactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `txn_user_date_idx` ON `transactions` (`user_id`,`txn_date`,`id`);--> statement-breakpoint
CREATE INDEX `txn_user_account_date_idx` ON `transactions` (`user_id`,`account_id`,`txn_date`);--> statement-breakpoint
CREATE INDEX `txn_user_to_account_idx` ON `transactions` (`user_id`,`to_account_id`);--> statement-breakpoint
CREATE INDEX `txn_user_category_date_idx` ON `transactions` (`user_id`,`category_id`,`txn_date`);--> statement-breakpoint
-- Existing bank-to-card transfers were card bill payments; give them their own type.
UPDATE `transactions` SET `type` = 'bill_payment' WHERE `type` = 'transfer' AND `to_account_id` IN (SELECT `id` FROM `accounts` WHERE `kind` = 'card');
