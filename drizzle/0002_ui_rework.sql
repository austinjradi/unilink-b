CREATE TABLE `post_reactions` (
	`post_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reply_reactions` (
	`reply_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`reply_id`, `user_id`),
	FOREIGN KEY (`reply_id`) REFERENCES `replies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `replies` ADD `parent_id` integer REFERENCES replies(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `tag` text;--> statement-breakpoint
ALTER TABLE `users` ADD `avatar` text;