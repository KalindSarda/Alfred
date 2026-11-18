ALTER TABLE `holding_kinds` ADD `broker_use` text DEFAULT 'never' NOT NULL;--> statement-breakpoint
UPDATE `holding_kinds` SET `broker_use` = 'required' WHERE `key` IN ('stock', 'fund', 'crypto');
