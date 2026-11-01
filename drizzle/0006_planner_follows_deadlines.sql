ALTER TABLE `planner_assignments` ADD `deadline_id` integer REFERENCES deadlines(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `planner_assignments` ADD `assessment_id` integer REFERENCES assessments(id) ON DELETE set null;
