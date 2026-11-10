import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppDatabase } from '../../src/main/db/client'
import { createTransactionRunner } from '../../src/main/db/transaction'
import { createMilestoneRepository } from '../../src/main/repositories/milestone-repository'
import { createProjectRepository } from '../../src/main/repositories/project-repository'
import { createTaskRepository } from '../../src/main/repositories/task-repository'

// 自動テスト専用の一時ディレクトリ。開発用・通常利用のuserDataは使わない。
export const MIGRATIONS_DIR = join(process.cwd(), 'migrations')

// migrations/meta/_journal.json に登録されているマイグレーション数
export const MIGRATION_COUNT = (
  JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] }
).entries.length

export function createTempDir(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'gtd-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// TaskServiceの依存（所属先の確認・トランザクション）を、同じ一時DBの接続で用意する（フェーズ5.2）
export function taskServiceDeps(db: AppDatabase) {
  return {
    repository: createTaskRepository(db),
    findProject: createProjectRepository(db).findById,
    findMilestone: createMilestoneRepository(db).findById,
    transaction: createTransactionRunner(db)
  }
}

// MilestoneServiceの依存（フェーズ5.4）
export function milestoneServiceDeps(db: AppDatabase) {
  const tasks = createTaskRepository(db)
  return {
    repository: createMilestoneRepository(db),
    findProject: createProjectRepository(db).findById,
    countTasks: tasks.countByMilestone,
    hideTasks: tasks.hideByMilestone,
    transaction: createTransactionRunner(db)
  }
}

// ProjectServiceの依存（未完了タスクの件数・トランザクション）を、同じ一時DBの接続で用意する（フェーズ5.3）
// フェーズ5.6: 作成時の初期マイルストン・削除時の件数と所属解除も、同じ接続のRepositoryで用意する
export function projectServiceDeps(db: AppDatabase) {
  const tasks = createTaskRepository(db)
  const milestones = createMilestoneRepository(db)
  return {
    repository: createProjectRepository(db),
    countOpenTasks: tasks.countOpenByProject,
    insertMilestone: milestones.insert,
    countMilestones: milestones.countByProject,
    detachMilestones: milestones.detachByProject,
    countTasks: tasks.countByProject,
    detachAndHideTasks: tasks.detachAndHideByProject,
    transaction: createTransactionRunner(db)
  }
}

// プロジェクトの最初のマイルストン（作成時に自動で作られる「新しいマイルストン」。フェーズ5.6）を所属先として返す。
// フェーズ5.6からプロジェクトだけへの所属は廃止したため、プロジェクトにタスクを置くテストはこれを使う
export function inProject(db: AppDatabase, projectId: string): { projectId: string; milestoneId: string } {
  const milestone = createMilestoneRepository(db)
    .listAll()
    .find((row) => row.projectId === projectId)
  if (!milestone) throw new Error(`プロジェクト ${projectId} にマイルストンがありません`)
  return { projectId, milestoneId: milestone.id }
}
