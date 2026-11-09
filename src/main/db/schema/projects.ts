import { sqliteTable, text } from 'drizzle-orm/sqlite-core'

// プロジェクト（フェーズ5.1）。
// - id: crypto.randomUUID() で生成するUUID v4（文字列）
// - created_at / updated_at / completed_at: UTCのISO 8601文字列。completed_at は未完了ならNULL
// - 名前の重複は許可する（一意制約なし）
// - タスクとの関連（tasks.project_id）はフェーズ5.2で追加する
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  completedAt: text('completed_at')
})

export type ProjectRow = typeof projects.$inferSelect
