import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import type { AppDatabase } from './client'

// Drizzleが適用履歴を記録するテーブル（drizzle-ormの既定名）
const MIGRATIONS_TABLE = '__drizzle_migrations'

export type MigrationResult = {
  appliedBefore: number
  appliedAfter: number
}

function countAppliedMigrations(db: AppDatabase): number {
  const exists = db.$client
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE)
  if (!exists) return 0
  const row = db.$client.prepare(`SELECT COUNT(*) AS count FROM "${MIGRATIONS_TABLE}"`).get() as {
    count: number
  }
  return row.count
}

// 起動時に未適用のマイグレーションだけを適用する（drizzle-kitは使わない）。
// drizzle-ormが1つのトランザクションで適用し、失敗時はROLLBACKして例外を投げる。
// 失敗時にDBファイルを削除・初期化して回避することはしない。
// 将来、スキーマ更新前のバックアップはこの関数の先頭（未適用がある場合）に追加する。
export function runMigrations(db: AppDatabase, migrationsDir: string): MigrationResult {
  if (!existsSync(join(migrationsDir, 'meta', '_journal.json'))) {
    throw new Error(`マイグレーションファイルが見つかりません: ${migrationsDir}`)
  }
  const appliedBefore = countAppliedMigrations(db)
  migrate(db, { migrationsFolder: migrationsDir })
  return { appliedBefore, appliedAfter: countAppliedMigrations(db) }
}
