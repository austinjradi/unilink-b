DROP TABLE `chat_link_flags`;--> statement-breakpoint
DROP TABLE `password_resets`;--> statement-breakpoint
ALTER TABLE `assessments` DROP COLUMN `score`;--> statement-breakpoint
ALTER TABLE `course_info` DROP COLUMN `professor`;--> statement-breakpoint
ALTER TABLE `course_info` DROP COLUMN `professor_email`;--> statement-breakpoint
ALTER TABLE `course_info` DROP COLUMN `office_hours`;--> statement-breakpoint
ALTER TABLE `course_info` DROP COLUMN `location`;--> statement-breakpoint
ALTER TABLE `deadlines` DROP COLUMN `completed_at`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `program`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `year`;--> statement-breakpoint
ALTER TABLE `users` DROP COLUMN `study_minutes_per_day`;