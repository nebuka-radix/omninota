import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { milestones } from './milestones'
import { projects } from './projects'

// フェーズ2: 永続化検証に必要な最小項目だけを持つ。
// - id: crypto.randomUUID() で生成するUUID v4（文字列）
// - created_at / updated_at: UTCのISO 8601文字列（例: 2026-11-09T10:00:00.000Z）
//   固定長・UTC固定なので、文字列の大小比較が時刻順と一致する。
// - done_on: 完了日時（UTCのISO 8601文字列）。未完了ならNULL。0010 で completed_at から名前を変更（値・形式はそのまま）。
//   タスクには done の列を持たない。完了状態（done = true / false）は done_on の有無から導出する論理上の状態（フェーズ4から同じ）。
// - project_id: 所属するプロジェクト（0件または1件）。NULLは未所属（フェーズ5.2）。
//   ON DELETE は指定しない（既定の NO ACTION）。プロジェクトの削除（フェーズ5.6）では、Serviceが先に所属を外してから削除する
//   （外部キーの連鎖でタスクを消さない）。
// - milestone_id: 所属するマイルストン（フェーズ5.4）。フェーズ5.6から、表示中のタスクは
//   「Inbox: project_id・milestone_id ともにNULL」か「プロジェクト所属: 両方あり」のどちらか（プロジェクトだけの所属は廃止）。
// - hidden_at: 削除由来で画面に表示しなくなった日時（フェーズ5.6）。NULLなら表示対象。
//   マイルストンの削除: project_id は残し milestone_id = NULL。プロジェクトの削除: 両方NULL。
//   ID がNULLなだけでは通常のInboxタスクと区別できないため、この列で区別する。非表示のタスクは一覧・件数・更新APIの対象外。
//   DBの外部キーはマイルストンの存在だけを保証する。「project_id があること」「同じプロジェクトのマイルストンであること」は
//   Service（TaskService.setAssignment / create）がトランザクション内で保証する（既存テーブルにCHECK・複合外部キーを足すと
//   SQLiteではテーブルの再作成が必要になるため）。
// - position: マイルストン内の手動順（フェーズ5.9。0007で追加）。NULLは手動順なし（作成日時の古い順・IDの昇順で表示）。
//   同じマイルストンの表示中のタスクは「全件に値がある」か「全件NULL」のどちらか（Serviceが保つ）。
//   並べ替えで初めて値が入る。手動順のあるマイルストンへの追加・移動は末尾（最大値+1）、Inboxへ戻すとNULL。
//   並べ替えでは created_at・done_on・updated_at を変えない。
// - dueto: 期限（フェーズ6。0008で追加）。日付のみ "YYYY-MM-DD" の TEXT（時刻・タイムゾーンなし。UTC日時へ変換しない）。NULLは未設定。
//   SQLiteは型を検証しないため、実在する暦日かは Main の入力検証で確かめる。固定長のため文字列の比較が日付の前後と一致する。
// - favorite: お気に入り（0009で追加）。論理型。SQLiteには真偽値の型がないため、Drizzle の boolean モードで INTEGER の 0 / 1 として格納する。
//   NOT NULL・既定値 false（既存のタスクも false）。未設定（NULL）は許容しない。
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    doneOn: text('done_on'),
    projectId: text('project_id').references(() => projects.id),
    milestoneId: text('milestone_id').references(() => milestones.id),
    hiddenAt: text('hidden_at'),
    position: integer('position'),
    dueto: text('dueto'),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false)
  },
  (table) => [
    index('tasks_created_at_id_idx').on(table.createdAt, table.id),
    index('tasks_project_id_idx').on(table.projectId),
    index('tasks_milestone_id_idx').on(table.milestoneId),
    // Summary Review の期間の取得（dueto の範囲）に使う
    index('tasks_dueto_idx').on(table.dueto)
  ]
)

export type TaskRow = typeof tasks.$inferSelect
export type NewTaskRow = typeof tasks.$inferInsert
