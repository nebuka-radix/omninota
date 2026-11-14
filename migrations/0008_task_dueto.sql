-- フェーズ6: タスクの期限（drizzle-kit の生成結果に説明を追記したもの）。
-- dueto は日付のみ "YYYY-MM-DD" の TEXT（時刻・タイムゾーンなし）。既存のタスクはすべて NULL（未設定）。作成日時などから補完しない。
-- 索引は Summary Review の期間（dueto の範囲）の取得に使う。
ALTER TABLE `tasks` ADD `dueto` text;--> statement-breakpoint
CREATE INDEX `tasks_dueto_idx` ON `tasks` (`dueto`);