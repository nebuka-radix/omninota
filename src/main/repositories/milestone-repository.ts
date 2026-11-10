import { asc, eq } from 'drizzle-orm'
import type { AppDatabase } from '../db/client'
import { milestones, type MilestoneRow } from '../db/schema'

// SQLを使う取得・保存だけを置く。業務ルール（日時の付与・不要更新の判定・所属プロジェクトの確認）はServiceで行う。
export type MilestoneRepository = {
  insert(row: MilestoneRow): void
  findById(id: string): MilestoneRow | undefined
  // 作成日時の古い順・IDの昇順（全プロジェクト分。表示もこの順）
  listAll(): MilestoneRow[]
  updateName(id: string, name: string, updatedAt: string): MilestoneRow | undefined
}

export function createMilestoneRepository(db: AppDatabase): MilestoneRepository {
  return {
    insert(row) {
      db.insert(milestones).values(row).run()
    },
    findById(id) {
      return db.select().from(milestones).where(eq(milestones.id, id)).get()
    },
    listAll() {
      return db.select().from(milestones).orderBy(asc(milestones.createdAt), asc(milestones.id)).all()
    },
    updateName(id, name, updatedAt) {
      return db.update(milestones).set({ name, updatedAt }).where(eq(milestones.id, id)).returning().get()
    }
  }
}
