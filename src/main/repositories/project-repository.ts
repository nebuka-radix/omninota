import { asc, eq } from 'drizzle-orm'
import type { AppDatabase } from '../db/client'
import { projects, type ProjectRow } from '../db/schema'

// SQLを使う取得・保存だけを置く。業務ルール（日時の付与・不要更新の判定）はServiceで行う。
export type ProjectRepository = {
  insert(row: ProjectRow): void
  findById(id: string): ProjectRow | undefined
  // 作成日時の古い順・IDの昇順（表示順はRenderer側で決める。ここでは安定した順序で返す）
  listAll(): ProjectRow[]
  // 更新した行を返す。対象がなければundefined
  updateName(id: string, name: string, updatedAt: string): ProjectRow | undefined
  // 完了状態の更新（done と done_on を同じ更新で書き換える）。完了は done = true・done_on = 日時、取り消しは false・NULL
  updateDone(id: string, doneOn: string | null, updatedAt: string): ProjectRow | undefined
  // 物理削除（フェーズ5.6）。所属するマイルストン・タスクの所属解除はServiceが先に行う。削除した件数を返す
  delete(id: string): number
}

export function createProjectRepository(db: AppDatabase): ProjectRepository {
  return {
    insert(row) {
      db.insert(projects).values(row).run()
    },
    findById(id) {
      return db.select().from(projects).where(eq(projects.id, id)).get()
    },
    listAll() {
      return db.select().from(projects).orderBy(asc(projects.createdAt), asc(projects.id)).all()
    },
    updateName(id, name, updatedAt) {
      return db.update(projects).set({ name, updatedAt }).where(eq(projects.id, id)).returning().get()
    },
    updateDone(id, doneOn, updatedAt) {
      return db.update(projects).set({ done: doneOn !== null, doneOn, updatedAt }).where(eq(projects.id, id)).returning().get()
    },
    delete(id) {
      return db.delete(projects).where(eq(projects.id, id)).run().changes
    }
  }
}
