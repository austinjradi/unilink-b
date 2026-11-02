CREATE TABLE `board_visits` (
	`user_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `class_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
