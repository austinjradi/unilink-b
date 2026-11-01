CREATE TABLE `assessment_scores` (
	`assessment_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`score` real NOT NULL,
	PRIMARY KEY(`assessment_id`, `user_id`),
	FOREIGN KEY (`assessment_id`) REFERENCES `assessments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_link_votes` (
	`link_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`vote` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`link_id`, `user_id`),
	FOREIGN KEY (`link_id`) REFERENCES `chat_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `class_details` (
	`class_id` integer PRIMARY KEY NOT NULL,
	`professor` text DEFAULT '' NOT NULL,
	`professor_email` text DEFAULT '' NOT NULL,
	`office_hours` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`updated_by_id` integer,
	`updated_at` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `deadline_done` (
	`deadline_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`deadline_id`, `user_id`),
	FOREIGN KEY (`deadline_id`) REFERENCES `deadlines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
DROP INDEX `classes_course_term_idx`;--> statement-breakpoint
ALTER TABLE `classes` ADD `section` text DEFAULT '001' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `classes_course_term_section_idx` ON `classes` (`course_id`,`term`,`section`);--> statement-breakpoint
ALTER TABLE `chat_links` ADD `purpose` text DEFAULT 'course' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_links` ADD `chat_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `kind` text DEFAULT 'question' NOT NULL;--> statement-breakpoint
ALTER TABLE `posts` ADD `accepted_reply_id` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `deleted_at` integer;--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `visibility` text DEFAULT 'class' NOT NULL;--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `format` text DEFAULT 'in-person' NOT NULL;--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `meeting_url` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `study_sessions` ADD `invite_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `pronouns` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `faculty` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `grad_year` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `recovery_code_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `weekly_study_minutes` text;