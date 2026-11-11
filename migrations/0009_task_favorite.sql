-- お気に入り（drizzle-kit の生成結果に説明を追記したもの）。
-- favorite は論理型（INTEGER の 0 / 1。Drizzle の boolean モード。SQLite は false を 0 として扱う）。NOT NULL・既定値 false で、既存のタスクもすべて false になる。
ALTER TABLE `tasks` ADD `favorite` integer DEFAULT false NOT NULL;
