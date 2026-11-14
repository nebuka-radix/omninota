-- フェーズ5.9: マイルストン内のタスクの手動順と、プロジェクト内のマイルストン（カード）の手動順（drizzle-kit の生成結果に説明を追記したもの）。
-- 既存のデータはすべて NULL（手動順なし）。表示は従来どおり作成日時の古い順・IDの昇順になる（初期順はこの2つから構成する）。
-- 既存の行の created_at・updated_at・completed_at などは変えない。
ALTER TABLE `milestones` ADD `position` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `position` integer;