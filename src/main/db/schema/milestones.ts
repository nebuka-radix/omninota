import { index, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

// マイルストン（プロジェクト配下の区切り）。
// - id: crypto.randomUUID() で生成するUUID v4
// - project_id: 所属プロジェクト（必須。付け替えは未対応）
// - created_at / updated_at: UTCのISO 8601文字列
// - 名前の重複は許可する。完了状態・期限・削除・並べ替えは持たない
export const milestones = sqliteTable(
  'milestones',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (table) => [index('milestones_project_id_idx').on(table.projectId)]
)

export type MilestoneRow = typeof milestones.$inferSelect
