ALTER TABLE `todos` ADD `repeats_weekly` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `todos` ADD `previous_id` integer;