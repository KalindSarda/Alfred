ALTER TABLE `categories` ADD `is_essential` integer DEFAULT false NOT NULL;
--> statement-breakpoint
UPDATE `categories` SET `is_essential` = 1 WHERE `kind` = 'expense' AND `name` IN ('Groceries', 'Transport', 'Fuel', 'Bills & Utilities', 'Rent', 'Health', 'Insurance', 'Education');
