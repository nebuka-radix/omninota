ALTER TABLE `tasks` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
CREATE INDEX `tasks_project_id_idx` ON `tasks` (`project_id`);