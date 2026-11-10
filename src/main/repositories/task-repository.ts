import { and, count, desc, eq, isNull, sql } from 'drizzle-orm'
import type { AppDatabase } from '../db/client'
import { tasks, type NewTaskRow, type TaskRow } from '../db/schema'

// SQLを使う取得・保存だけを置く。業務ルール（日時の付与・不要更新の判定）はServiceで行う。
// 更新は用途別の関数に限定し、任意の列を書き換える関数は作らない。
// フェーズ5.6: 削除由来で非表示のタスク（hidden_at あり）は、一覧・件数・通常の更新の対象にしない。
// 更新系は WHERE に hidden_at IS NULL を含め、非表示のタスクを再表示・再利用しない（遅れて届いた更新でも行を変えない）。
export type TaskRepository = {
  insert(row: NewTaskRow): void
  // 非表示のタスクも返す（Serviceが hiddenAt を見て「見つからない」として扱う）
  findById(id: string): TaskRow | undefined
  // 表示対象のタスク（hidden_at IS NULL）だけ。新しい順。作成日時が同じ場合はidの降順で、常に同じ順序になる。
  listAll(): TaskRow[]
  // 更新した行を返す。対象がない・非表示ならundefined。
  updateTitle(id: string, title: string, updatedAt: string): TaskRow | undefined
  updateCompletedAt(id: string, completedAt: string | null, updatedAt: string): TaskRow | undefined
  // 所属（プロジェクト・マイルストン）の変更・解除を1回の更新で行う（フェーズ5.4）。
  // 存在・組み合わせ・完了状態の確認はServiceで行う（存在は外部キーでも保証される）
  updateAssignment(id: string, projectId: string | null, milestoneId: string | null, updatedAt: string): TaskRow | undefined
  // プロジェクトに所属する、表示中の未完了タスクの件数（フェーズ5.3。プロジェクトの完了判定に使う。索引 tasks_project_id_idx）。
  // 削除由来の非表示タスクは数えない（フェーズ5.6）
  countOpenByProject(projectId: string): number
  // 表示中のタスクの物理削除（フェーズ5.6）。削除した件数（0 or 1）を返す
  deleteVisible(id: string): number
  // マイルストンに所属するタスクの件数（完了・未完了、画面の絞り込みとは無関係にDBで数える）
  countByMilestone(milestoneId: string): number
  // マイルストンの削除に伴う所属解除と非表示化。project_id は残す。変更した件数を返す
  hideByMilestone(milestoneId: string, at: string): number
  // プロジェクトに所属するタスクの件数（既に非表示のものを含む）と、そのうち非表示の件数
  countByProject(projectId: string): { total: number; hidden: number }
  // プロジェクトの削除に伴う所属解除と非表示化（既に非表示のタスクも含めて project_id・milestone_id をNULLにする）。
  // hidden_at は未設定のものだけ設定する（最初に非表示になった日時を残す）。変更した件数を返す
  detachAndHideByProject(projectId: string, at: string): number
}

export function createTaskRepository(db: AppDatabase): TaskRepository {
  const visible = (id: string) => and(eq(tasks.id, id), isNull(tasks.hiddenAt))
  return {
    insert(row) {
      db.insert(tasks).values(row).run()
    },
    findById(id) {
      return db.select().from(tasks).where(eq(tasks.id, id)).get()
    },
    listAll() {
      return db.select().from(tasks).where(isNull(tasks.hiddenAt)).orderBy(desc(tasks.createdAt), desc(tasks.id)).all()
    },
    updateTitle(id, title, updatedAt) {
      return db.update(tasks).set({ title, updatedAt }).where(visible(id)).returning().get()
    },
    updateCompletedAt(id, completedAt, updatedAt) {
      return db.update(tasks).set({ completedAt, updatedAt }).where(visible(id)).returning().get()
    },
    updateAssignment(id, projectId, milestoneId, updatedAt) {
      return db.update(tasks).set({ projectId, milestoneId, updatedAt }).where(visible(id)).returning().get()
    },
    countOpenByProject(projectId) {
      const row = db
        .select({ value: count() })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.completedAt), isNull(tasks.hiddenAt)))
        .get()
      return row?.value ?? 0
    },
    deleteVisible(id) {
      return db.delete(tasks).where(visible(id)).run().changes
    },
    countByMilestone(milestoneId) {
      const row = db.select({ value: count() }).from(tasks).where(eq(tasks.milestoneId, milestoneId)).get()
      return row?.value ?? 0
    },
    hideByMilestone(milestoneId, at) {
      // タイトル・完了状態・作成日時・project_id は変えない。所属が変わるため updated_at は操作日時にする（setAssignment と同じ規則）
      return db
        .update(tasks)
        .set({ milestoneId: null, hiddenAt: sql`coalesce(${tasks.hiddenAt}, ${at})`, updatedAt: at })
        .where(eq(tasks.milestoneId, milestoneId))
        .run().changes
    },
    countByProject(projectId) {
      const row = db
        .select({ total: count(), hidden: count(tasks.hiddenAt) })
        .from(tasks)
        .where(eq(tasks.projectId, projectId))
        .get()
      return { total: row?.total ?? 0, hidden: row?.hidden ?? 0 }
    },
    detachAndHideByProject(projectId, at) {
      return db
        .update(tasks)
        .set({ projectId: null, milestoneId: null, hiddenAt: sql`coalesce(${tasks.hiddenAt}, ${at})`, updatedAt: at })
        .where(eq(tasks.projectId, projectId))
        .run().changes
    }
  }
}

