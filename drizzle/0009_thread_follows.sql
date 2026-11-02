CREATE TABLE `post_follows` (
	`post_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`following` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT OR IGNORE INTO `post_follows` (`post_id`, `user_id`, `following`)
  SELECT `id`, `author_id`, 1 FROM `posts` WHERE `deleted_at` IS NULL
  UNION SELECT `post_id`, `author_id`, 1 FROM `replies`;
--> statement-breakpoint
DELETE FROM `post_follows` WHERE `user_id` IN (SELECT `id` FROM `users` WHERE `email` = 'former.student@unilink.invalid');
