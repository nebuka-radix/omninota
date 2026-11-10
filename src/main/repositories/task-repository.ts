import { and, count, desc, eq, isNull } from 'drizzle-orm'
import type { AppDatabase } from '../db/client'
import { tasks, type NewTaskRow, type TaskRow } from '../db/schema'

// SQLを使う取得・保存だけを置く。業務ルール（日時の付与・不要更新の判定）はServiceで行う。
// 更新は用途別の関数に限定し、任意の列を書き換える関数は作らない。
export type TaskRepository = {
  insert(row: NewTaskRow): void
  findById(id: string): TaskRow | undefined
  // 新しい順。作成日時が同じ場合はidの降順で、常に同じ順序になる。
  listAll(): TaskRow[]
  // 更新した行を返す。対象がなければundefined。
  updateTitle(id: string, title: string, updatedAt: string): TaskRow | undefined
  updateCompletedAt(id: string, completedAt: string | null, updatedAt: string): TaskRow | undefined
  // 所属（プロジェクト・マイルストン）の変更・解除を1回の更新で行う（フェーズ5.4）。
  // 存在・組み合わせ・完了状態の確認はServiceで行う（存在は外部キーでも保証される）
  updateAssignment(id: string, projectId: string | null, milestoneId: string | null, updatedAt: string): TaskRow | undefined
  // プロジェクトに所属する未完了タスクの件数（フェーズ5.3。プロジェクトの完了判定に使う。索引 tasks_project_id_idx）
  countOpenByProject(projectId: string): number
}

export function createTaskRepository(db: AppDatabase): TaskRepository {
  return {
    insert(row) {
      db.insert(tasks).values(row).run()
    },
    findById(id) {
      return db.select().from(tasks).where(eq(tasks.id, id)).get()
    },
    listAll() {
      return db.select().from(tasks).orderBy(desc(tasks.createdAt), desc(tasks.id)).all()
    },
    updateTitle(id, title, updatedAt) {
      return db.update(tasks).set({ title, updatedAt }).where(eq(tasks.id, id)).returning().get()
    },
    updateCompletedAt(id, completedAt, updatedAt) {
      return db.update(tasks).set({ completedAt, updatedAt }).where(eq(tasks.id, id)).returning().get()
    },
    updateAssignment(id, projectId, milestoneId, updatedAt) {
      return db.update(tasks).set({ projectId, milestoneId, updatedAt }).where(eq(tasks.id, id)).returning().get()
    },
    countOpenByProject(projectId) {
      const row = db
        .select({ value: count() })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), isNull(tasks.completedAt)))
        .get()
      return row?.value ?? 0
    }
  }
}
