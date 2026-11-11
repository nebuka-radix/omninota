import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { projects } from './projects'

// マイルストン（プロジェクト配下の区切り）。
// - id: crypto.randomUUID() で生成するUUID v4
// - project_id: 所属プロジェクト。付け替えは未対応。
//   NULL は「プロジェクトの削除により画面に表示しなくなったマイルストン」（フェーズ5.6。0006 でNULL可に変更）。
//   通常の作成・表示・操作の対象は project_id があるものだけ（Repository / Service で除外する）
// - created_at / updated_at: UTCのISO 8601文字列
// - 名前の重複は許可する。完了状態・期限は持たない。削除は物理削除（フェーズ5.6。所属タスクは非表示にして残す）
// - position: プロジェクト内のカードの手動順（フェーズ5.9。0007で追加）。NULLは手動順なし（作成日時の古い順・IDの昇順）。
//   同じプロジェクトの表示中のマイルストンは「全件に値がある」か「全件NULL」のどちらか（Serviceが保つ）。新しいマイルストンは末尾
export const milestones = sqliteTable(
  'milestones',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id),
    name: text('name').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    position: integer('position')
  },
  (table) => [index('milestones_project_id_idx').on(table.projectId)]
)

export type MilestoneRow = typeof milestones.$inferSelect
