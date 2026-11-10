import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

// フェーズ2: 永続化検証に必要な最小項目だけを持つ。
// - id: crypto.randomUUID() で生成するUUID v4（文字列）
// - created_at / updated_at: UTCのISO 8601文字列（例: 2026-11-09T10:00:00.000Z）
//   固定長・UTC固定なので、文字列の大小比較が時刻順と一致する。
// - completed_at: 完了日時（UTCのISO 8601文字列）。未完了ならNULL。完了状態はこの列だけから導出する（フェーズ4）。
// - project_id: 所属するプロジェクト（0件または1件）。NULLは未所属（フェーズ5.2）。
//   プロジェクトの削除は初期版の対象外のため、ON DELETE は指定しない（既定の NO ACTION）。
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
    projectId: text('project_id').references(() => projects.id)
  },
  (table) => [
    index('tasks_created_at_id_idx').on(table.createdAt, table.id),
    index('tasks_project_id_idx').on(table.projectId)
  ]
)

export type TaskRow = typeof tasks.$inferSelect
export type NewTaskRow = typeof tasks.$inferInsert
