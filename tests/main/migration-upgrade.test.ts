import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createSettingsRepository } from '../../src/main/repositories/settings-repository'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createTempDir, MIGRATION_COUNT, MIGRATIONS_DIR } from '../helpers/temp-database'

type Journal = { entries: { tag: string }[] }

// 先頭 n 件のマイグレーションだけを含むフォルダーを一時ディレクトリに作る（過去のフェーズのDBの再現用）。
function createPartialMigrations(targetDir: string, count: number): void {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as Journal
  const entries = journal.entries.slice(0, count)
  mkdirSync(join(targetDir, 'meta'), { recursive: true })
  writeFileSync(join(targetDir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) {
    copyFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(targetDir, `${entry.tag}.sql`))
  }
}

// 旧スキーマのDBへ、当時のアプリと同じ列だけでタスクを登録する（現在のコードは新しい列を書き込むため使わない）
const oldTasks = [
  { id: '11111111-1111-4111-8111-111111111111', title: '既存タスク1', at: '2026-11-09T01:00:00.000Z' },
  { id: '22222222-2222-4222-8222-222222222222', title: '既存タスク2', at: '2026-11-09T02:00:00.000Z' }
]
function insertOldTasks(db: AppDatabase): void {
  const insert = db.$client.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
  for (const task of oldTasks) insert.run(task.id, task.title, task.at, task.at)
}
const expectedAfterUpgrade = oldTasks
  .map((task) => ({ id: task.id, title: task.title, createdAt: task.at, updatedAt: task.at, completedAt: null }))
  .reverse() // 新しい順

describe('既存データを保持したマイグレーション', () => {
  let temp: ReturnType<typeof createTempDir>

  beforeEach(() => {
    temp = createTempDir()
  })

  afterEach(() => {
    temp.cleanup()
  })

  it('フェーズ2（tasksのみ）→ 現在: 既存タスクは未完了として保持し、app_settingsを追加する', () => {
    const dbFile = join(temp.dir, 'gtd.sqlite')
    const oldMigrations = join(temp.dir, 'migrations-phase2')
    createPartialMigrations(oldMigrations, 1)

    const old = openDatabase(dbFile)
    expect(runMigrations(old, oldMigrations)).toEqual({ appliedBefore: 0, appliedAfter: 1 })
    insertOldTasks(old)
    closeDatabase(old)

    const upgraded = openDatabase(dbFile)
    expect(runMigrations(upgraded, MIGRATIONS_DIR)).toEqual({ appliedBefore: 1, appliedAfter: MIGRATION_COUNT })
    expect(createTaskRepository(upgraded).listAll()).toEqual(expectedAfterUpgrade)
    const tables = upgraded.$client
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tasks', 'app_settings') ORDER BY name")
      .all()
    expect(tables).toEqual([{ name: 'app_settings' }, { name: 'tasks' }])
    closeDatabase(upgraded)

    // 再起動相当: 同じマイグレーションを重複適用しない
    const restarted = openDatabase(dbFile)
    expect(runMigrations(restarted, MIGRATIONS_DIR)).toEqual({
      appliedBefore: MIGRATION_COUNT,
      appliedAfter: MIGRATION_COUNT
    })
    expect(createTaskRepository(restarted).listAll()).toEqual(expectedAfterUpgrade)
    closeDatabase(restarted)
  })

  it('フェーズ3（tasks + app_settings）→ 現在: completed_atを追加し、タスクとWorkspace設定を保持する', () => {
    const dbFile = join(temp.dir, 'gtd.sqlite')
    const oldMigrations = join(temp.dir, 'migrations-phase3')
    createPartialMigrations(oldMigrations, 2)
    const workspaceValue = JSON.stringify({
      version: 1,
      sidebarWidth: 300,
      detailWidth: 320,
      detailVisible: false,
      lastRoute: '/settings'
    })

    const old = openDatabase(dbFile)
    expect(runMigrations(old, oldMigrations)).toEqual({ appliedBefore: 0, appliedAfter: 2 })
    insertOldTasks(old)
    createSettingsRepository(old).upsert({ key: 'workspace', value: workspaceValue, updatedAt: '2026-11-09T03:00:00.000Z' })
    closeDatabase(old)

    const upgraded = openDatabase(dbFile)
    expect(runMigrations(upgraded, MIGRATIONS_DIR)).toEqual({ appliedBefore: 2, appliedAfter: MIGRATION_COUNT })
    expect(createTaskRepository(upgraded).listAll()).toEqual(expectedAfterUpgrade)
    expect(createSettingsRepository(upgraded).get('workspace')).toEqual({
      key: 'workspace',
      value: workspaceValue,
      updatedAt: '2026-11-09T03:00:00.000Z'
    })
    const columns = upgraded.$client.prepare('PRAGMA table_info(tasks)').all() as { name: string; notnull: number }[]
    expect(columns.find((column) => column.name === 'completed_at')).toMatchObject({ notnull: 0 })
    closeDatabase(upgraded)

    const restarted = openDatabase(dbFile)
    expect(runMigrations(restarted, MIGRATIONS_DIR)).toEqual({
      appliedBefore: MIGRATION_COUNT,
      appliedAfter: MIGRATION_COUNT
    })
    closeDatabase(restarted)
  })
})
