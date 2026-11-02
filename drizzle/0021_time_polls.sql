CREATE TABLE `time_poll_options` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`poll_id` integer NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	FOREIGN KEY (`poll_id`) REFERENCES `time_polls`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `time_poll_votes` (
	`option_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`option_id`, `user_id`),
	FOREIGN KEY (`option_id`) REFERENCES `time_poll_options`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `time_polls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`host_id` integer NOT NULL,
	`title` text NOT NULL,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `time_polls_class_idx` ON `time_polls` (`class_id`);