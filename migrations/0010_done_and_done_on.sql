-- 完了管理の整理（手書き。drizzle-kit の列名変更の判定は対話式のため。スナップショット 0010 は schema と一致することを db:generate で確認済み）。
-- tasks: completed_at → done_on（値・形式はそのまま。UTC の ISO 8601 文字列）。タスクには done の列を追加しない（done_on の有無が完了状態）。
-- projects: completed_at → done_on（値はそのまま）、done を追加して既存の完了日時から移行する（完了済み = true、未完了 = false）。
--   移行の UPDATE は done だけを書き換え、updated_at・created_at は変えない。
-- milestones: done（false）・done_on（NULL）を追加する。既存の行は未完了のまま。
-- RENAME COLUMN は索引・外部キーの参照も合わせて変える（テーブルの再作成はしない。ID・所属・期限・お気に入り・手動順は変わらない）。
ALTER TABLE `tasks` RENAME COLUMN `completed_at` TO `done_on`;--> statement-breakpoint
ALTER TABLE `projects` RENAME COLUMN `completed_at` TO `done_on`;--> statement-breakpoint
ALTER TABLE `projects` ADD `done` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `projects` SET `done` = (`done_on` IS NOT NULL);--> statement-breakpoint
ALTER TABLE `milestones` ADD `done` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `milestones` ADD `done_on` text;
