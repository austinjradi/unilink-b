CREATE TABLE `app_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assessments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	`name` text NOT NULL,
	`weight` real NOT NULL,
	`score` real,
	`due_at` integer,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assessments_user_class_idx` ON `assessments` (`user_id`,`class_id`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_link_flags` (
	`link_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`link_id`, `user_id`),
	FOREIGN KEY (`link_id`) REFERENCES `chat_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `chat_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`owner_id` integer NOT NULL,
	`url` text NOT NULL,
	`platform` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`is_public` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_links_class_url_idx` ON `chat_links` (`class_id`,`url`);--> statement-breakpoint
CREATE TABLE `class_meetings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	`weekday` integer NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`course_id` integer NOT NULL,
	`term` text NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `classes_course_term_idx` ON `classes` (`course_id`,`term`);--> statement-breakpoint
CREATE TABLE `course_info` (
	`user_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	`professor` text DEFAULT '' NOT NULL,
	`professor_email` text DEFAULT '' NOT NULL,
	`office_hours` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`target_grade` text DEFAULT 'A' NOT NULL,
	PRIMARY KEY(`user_id`, `class_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject` text NOT NULL,
	`number` text NOT NULL,
	`title` text NOT NULL,
	`credits` real NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `courses_code_idx` ON `courses` (`subject`,`number`);--> statement-breakpoint
CREATE TABLE `deadlines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`class_id` integer,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`due_at` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `deadlines_user_due_idx` ON `deadlines` (`user_id`,`due_at`);--> statement-breakpoint
CREATE TABLE `enrollments` (
	`user_id` integer NOT NULL,
	`class_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `class_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `enrollments_class_idx` ON `enrollments` (`class_id`);--> statement-breakpoint
CREATE TABLE `password_resets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `planner_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`class_id` integer,
	`title` text NOT NULL,
	`due_at` integer NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`buffer_days` integer DEFAULT 1 NOT NULL,
	`attachment_name` text,
	`attachment_path` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `planner_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`assignment_id` integer NOT NULL,
	`title` text NOT NULL,
	`minutes` integer NOT NULL,
	`position` integer NOT NULL,
	`scheduled_for` text NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`done_at` integer,
	FOREIGN KEY (`assignment_id`) REFERENCES `planner_assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `planner_tasks_assignment_idx` ON `planner_tasks` (`assignment_id`);--> statement-breakpoint
CREATE TABLE `post_audience` (
	`post_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	PRIMARY KEY(`post_id`, `user_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `posts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`topic` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`visibility` text NOT NULL,
	`created_at` integer NOT NULL,
	`edited_at` integer,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `posts_class_idx` ON `posts` (`class_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `replies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`post_id` integer NOT NULL,
	`author_id` integer NOT NULL,
	`body` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `replies_post_idx` ON `replies` (`post_id`);--> statement-breakpoint
CREATE TABLE `study_session_members` (
	`session_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`status` text NOT NULL,
	`invited_by_id` integer,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `user_id`),
	FOREIGN KEY (`session_id`) REFERENCES `study_sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`invited_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`class_id` integer NOT NULL,
	`host_id` integer NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`capacity` integer,
	`cancelled_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`class_id`) REFERENCES `classes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `study_sessions_class_idx` ON `study_sessions` (`class_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`program` text DEFAULT '' NOT NULL,
	`year` integer,
	`study_minutes_per_day` integer DEFAULT 120 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);