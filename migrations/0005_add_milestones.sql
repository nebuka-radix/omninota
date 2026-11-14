CREATE TABLE `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `milestones_project_id_idx` ON `milestones` (`project_id`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `milestone_id` text REFERENCES milestones(id);--> statement-breakpoint
CREATE INDEX `tasks_milestone_id_idx` ON `tasks` (`milestone_id`);