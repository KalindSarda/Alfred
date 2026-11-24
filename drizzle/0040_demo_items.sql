CREATE TABLE `demo_items` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `demo_items_uq` ON `demo_items` (`user_id`,`kind`,`ref_id`);