import { desc, eq } from 'drizzle-orm'
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
    }
  }
}
