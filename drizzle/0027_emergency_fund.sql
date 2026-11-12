ALTER TABLE `accounts` ADD `is_emergency` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `emergency_months` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `emergency_target_paise` integer;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `emergency_horizon_months` integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE `holdings` ADD `is_emergency` integer DEFAULT false NOT NULL;