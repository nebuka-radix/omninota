-- フェーズ5.6: タスク・マイルストン・プロジェクトの削除と、所属ルールの変更（drizzle-kit の生成結果を手で書き換えたもの）。
-- 1. 一度限りの移行: プロジェクトに所属し、マイルストンが未設定のタスク（project_id IS NOT NULL AND milestone_id IS NULL）を物理削除する。
--    完了・未完了を問わない。Inbox（両方NULL）とマイルストン所属済みのタスクは削除しない。
--    （このマイグレーションは1回だけ適用される。以後の起動時にNULL所属のタスクを削除する処理はない）
DELETE FROM `tasks` WHERE `project_id` IS NOT NULL AND `milestone_id` IS NULL;--> statement-breakpoint
-- 2. 削除由来の非表示状態（日時）。既存のタスクはすべて表示対象（NULL）
ALTER TABLE `tasks` ADD `hidden_at` text;--> statement-breakpoint
-- 3. milestones.project_id をNULL可にする（SQLiteでは表の作り直しが必要）。
--    マイグレーションは1つのトランザクションで実行され、その中では PRAGMA foreign_keys を切り替えられない
--    （drizzle-kit が生成する PRAGMA foreign_keys=OFF は効かない）。外部キーを有効にしたまま作り直すため、
--    tasks.milestone_id の参照を一時的に退避してNULLにし、作り直した後に戻す（tasks の updated_at などは変えない）。
CREATE TABLE `__migration_task_milestones` (
	`task_id` text PRIMARY KEY NOT NULL,
	`milestone_id` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__migration_task_milestones`("task_id", "milestone_id") SELECT "id", "milestone_id" FROM `tasks` WHERE "milestone_id" IS NOT NULL;--> statement-breakpoint
UPDATE `tasks` SET `milestone_id` = NULL WHERE `milestone_id` IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_milestones`("id", "project_id", "name", "created_at", "updated_at") SELECT "id", "project_id", "name", "created_at", "updated_at" FROM `milestones`;--> statement-breakpoint
DROP TABLE `milestones`;--> statement-breakpoint
ALTER TABLE `__new_milestones` RENAME TO `milestones`;--> statement-breakpoint
CREATE INDEX `milestones_project_id_idx` ON `milestones` (`project_id`);--> statement-breakpoint
UPDATE `tasks` SET `milestone_id` = (SELECT `milestone_id` FROM `__migration_task_milestones` WHERE `task_id` = `tasks`.`id`) WHERE `id` IN (SELECT `task_id` FROM `__migration_task_milestones`);--> statement-breakpoint
DROP TABLE `__migration_task_milestones`;
