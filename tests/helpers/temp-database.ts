import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppDatabase } from '../../src/main/db/client'
import { createTransactionRunner } from '../../src/main/db/transaction'
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
    transaction: createTransactionRunner(db)
  }
}
