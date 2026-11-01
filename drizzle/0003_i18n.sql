ALTER TABLE `notifications` ADD `i18n` text;--> statement-breakpoint
ALTER TABLE `users` ADD `locale` text DEFAULT 'en' NOT NULL;