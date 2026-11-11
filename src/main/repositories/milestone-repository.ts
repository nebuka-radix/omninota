import { and, asc, count, eq, isNotNull, max, sql } from 'drizzle-orm'
import type { AppDatabase } from '../db/client'
import { milestones, type MilestoneRow } from '../db/schema'

// SQLを使う取得・保存だけを置く。業務ルール（日時の付与・不要更新の判定・所属プロジェクトの確認）はServiceで行う。
// フェーズ5.6: project_id がNULLのマイルストン（プロジェクトの削除で非表示になったもの）は、一覧・名前変更・削除の対象にしない。
export type MilestoneRepository = {
  insert(row: MilestoneRow): void
  // 非表示（project_id がNULL）のマイルストンも返す（Serviceが「見つからない」として扱う）
  findById(id: string): MilestoneRow | undefined
  // 表示対象（project_id あり）だけ。手動順（フェーズ5.9。NULLは後ろ）→ 作成日時の古い順 → IDの昇順（全プロジェクト分。表示もこの順）
  listAll(): MilestoneRow[]
  updateName(id: string, name: string, updatedAt: string): MilestoneRow | undefined
  // プロジェクトに所属するマイルストンの件数
  countByProject(projectId: string): number
  // プロジェクトの削除に伴う所属解除（project_id = NULL）。名前・作成日時は変えない。変更した件数を返す
  detachByProject(projectId: string, updatedAt: string): number
  // 表示中のマイルストンの物理削除。削除した件数（0 or 1）を返す
  deleteVisible(id: string): number
  // --- フェーズ5.9: カードの手動順 ---
  // プロジェクトの表示中のマイルストン（listAll と同じ順）
  listVisibleByProject(projectId: string): MilestoneRow[]
  // プロジェクトの表示中のマイルストンの手動順の最大値。手動順がなければ null
  maxPositionInProject(projectId: string): number | null
  // 手動順だけを書き換える（名前・作成日時・更新日時は変えない）。更新した件数を返す
  updatePosition(id: string, position: number): number
}

export function createMilestoneRepository(db: AppDatabase): MilestoneRepository {
  const visible = (id: string) => and(eq(milestones.id, id), isNotNull(milestones.projectId))
  return {
    insert(row) {
      db.insert(milestones).values(row).run()
    },
    findById(id) {
      return db.select().from(milestones).where(eq(milestones.id, id)).get()
    },
    listAll() {
      return db
        .select()
        .from(milestones)
        .where(isNotNull(milestones.projectId))
        .orderBy(sql`${milestones.position} IS NULL`, asc(milestones.position), asc(milestones.createdAt), asc(milestones.id))
        .all()
    },
    updateName(id, name, updatedAt) {
      return db.update(milestones).set({ name, updatedAt }).where(visible(id)).returning().get()
    },
    countByProject(projectId) {
      return db.select({ value: count() }).from(milestones).where(eq(milestones.projectId, projectId)).get()?.value ?? 0
    },
    detachByProject(projectId, updatedAt) {
      return db.update(milestones).set({ projectId: null, updatedAt }).where(eq(milestones.projectId, projectId)).run().changes
    },
    deleteVisible(id) {
      return db.delete(milestones).where(visible(id)).run().changes
    },
    listVisibleByProject(projectId) {
      return db
        .select()
        .from(milestones)
        .where(eq(milestones.projectId, projectId))
        .orderBy(sql`${milestones.position} IS NULL`, asc(milestones.position), asc(milestones.createdAt), asc(milestones.id))
        .all()
    },
    maxPositionInProject(projectId) {
      return db.select({ value: max(milestones.position) }).from(milestones).where(eq(milestones.projectId, projectId)).get()?.value ?? null
    },
    updatePosition(id, position) {
      return db.update(milestones).set({ position }).where(visible(id)).run().changes
    }
  }
}
