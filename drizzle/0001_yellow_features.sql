CREATE TABLE `course_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`code` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`credits` real NOT NULL,
	`term` text NOT NULL,
	`status` text NOT NULL,
	`grade` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_records_user_idx` ON `course_records` (`user_id`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`link` text,
	`dedupe_key` text,
	`created_at` integer NOT NULL,
	`read_at` integer,
	`delivered_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_idx` ON `notifications` (`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `study_mode_settings` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`auto_for_classes` integer DEFAULT true NOT NULL,
	`auto_for_sessions` integer DEFAULT true NOT NULL,
	`silence_notifications` integer DEFAULT true NOT NULL,
	`system_dnd` integer DEFAULT false NOT NULL,
	`manual_until` integer,
	`paused_until` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `todos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`title` text NOT NULL,
	`due_date` text,
	`class_id` integer,
	`done_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `todos_user_idx` ON `todos` (`user_id`);--> statement-breakpoint
ALTER TABLE `course_info` ADD `study_mode_auto` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `deadlines` ADD `completed_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `degree_program_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `notification_prefs` text;