CREATE TABLE `focus_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`planned_end` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `focus_log_user_idx` ON `focus_log` (`user_id`,`started_at`);