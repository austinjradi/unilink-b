ALTER TABLE `deadlines` ADD `official` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `deadlines` ADD `attachment_name` text;--> statement-breakpoint
ALTER TABLE `deadlines` ADD `attachment_path` text;--> statement-breakpoint
ALTER TABLE `posts` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `locked_at` integer;--> statement-breakpoint
ALTER TABLE `posts` ADD `removed_by_professor` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `replies` ADD `endorsed_at` integer;--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'student' NOT NULL;