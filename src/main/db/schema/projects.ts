import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

// プロジェクト（フェーズ5.1）。
// - id: crypto.randomUUID() で生成するUUID v4（文字列）
// - created_at / updated_at / done_on: UTCのISO 8601文字列（TEXT）。
// - done: 完了状態（0010で追加。論理型。Drizzle の boolean モードで INTEGER の 0 / 1。NOT NULL・既定 false）。
// - done_on: 完了日時（0010で completed_at から名前を変更。値・形式はそのまま）。未完了なら NULL。
//   done = true なら done_on あり、done = false なら done_on = NULL（Service が同じ更新で保つ。SQLite の CHECK は付けていない）
// - 名前の重複は許可する（一意制約なし）
// - タスクとの関連は tasks.project_id（フェーズ5.2）
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  doneOn: text('done_on')
})

export type ProjectRow = typeof projects.$inferSelect
