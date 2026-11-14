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
  .map((task) => ({ id: task.id, title: task.title, createdAt: task.at, updatedAt: task.at, doneOn: null, projectId: null, milestoneId: null, hiddenAt: null, position: null, dueto: null, favorite: false }))
  .reverse() // 新しい順（既存タスクは未所属で移行される）

// 旧スキーマのDBから、当時の列だけでタスクを読む（現在のRepositoryは新しい列も選択するため使わない）
function readOldTasks(db: AppDatabase) {
  return db.$client
    .prepare(
      'SELECT id, title, created_at AS createdAt, updated_at AS updatedAt, completed_at AS doneOn FROM tasks ORDER BY created_at DESC, id DESC'
    )
    .all() as Record<string, unknown>[]
}

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
    expect(createTaskRepository(upgraded).listAll()).toEqual((/* 049-important-default */ (expectedAfterUpgrade)).map((row) => ({ ...row, important: false })))
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
    expect(createTaskRepository(restarted).listAll()).toEqual((/* 051-important-restart-default */ (expectedAfterUpgrade)).map((row) => ({ ...row, important: false })))
    closeDatabase(restarted)
  })

  it('フェーズ4（completed_atまで）→ 現在: projectsを追加し、タスク（完了状態含む）とWorkspace設定を保持する', () => {
    const dbFile = join(temp.dir, 'gtd.sqlite')
    const oldMigrations = join(temp.dir, 'migrations-phase4')
    createPartialMigrations(oldMigrations, 3)
    const workspaceValue = JSON.stringify({
      version: 1,
      sidebarWidth: 300,
      detailWidth: 320,
      detailVisible: true,
      lastRoute: '/inbox'
    })

    const old = openDatabase(dbFile)
    expect(runMigrations(old, oldMigrations)).toEqual({ appliedBefore: 0, appliedAfter: 3 })
    insertOldTasks(old)
    old.$client.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').run('2026-11-09T05:00:00.000Z', oldTasks[0]?.id)
    createSettingsRepository(old).upsert({ key: 'workspace', value: workspaceValue, updatedAt: '2026-11-09T03:00:00.000Z' })
    const before = readOldTasks(old)
    closeDatabase(old)

    const upgraded = openDatabase(dbFile)
    expect(runMigrations(upgraded, MIGRATIONS_DIR)).toEqual({ appliedBefore: 3, appliedAfter: MIGRATION_COUNT })
    expect(createTaskRepository(upgraded).listAll()).toEqual((/* 049-important-default */ (before.map((task) => ({ ...task, projectId: null, milestoneId: null, hiddenAt: null, position: null, dueto: null, favorite: false })))).map((row) => ({ ...row, important: false })))
    expect(createSettingsRepository(upgraded).get('workspace')?.value).toBe(workspaceValue)
    expect(upgraded.$client.prepare('SELECT COUNT(*) AS c FROM projects').get()).toEqual({ c: 0 })
    closeDatabase(upgraded)

    const restarted = openDatabase(dbFile)
    expect(runMigrations(restarted, MIGRATIONS_DIR)).toEqual({
      appliedBefore: MIGRATION_COUNT,
      appliedAfter: MIGRATION_COUNT
    })
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
    expect(createTaskRepository(upgraded).listAll()).toEqual((/* 049-important-default */ (expectedAfterUpgrade)).map((row) => ({ ...row, important: false })))
    expect(createSettingsRepository(upgraded).get('workspace')).toEqual({
      key: 'workspace',
      value: workspaceValue,
      updatedAt: '2026-11-09T03:00:00.000Z'
    })
    const columns = upgraded.$client.prepare('PRAGMA table_info(tasks)').all() as { name: string; notnull: number }[]
    // 0002 で追加した completed_at は 0010 で done_on へ名前を変える
    expect(columns.find((column) => column.name === 'done_on')).toMatchObject({ notnull: 0 })
    expect(columns.some((column) => column.name === 'completed_at')).toBe(false)
    closeDatabase(upgraded)

    const restarted = openDatabase(dbFile)
    expect(runMigrations(restarted, MIGRATIONS_DIR)).toEqual({
      appliedBefore: MIGRATION_COUNT,
      appliedAfter: MIGRATION_COUNT
    })
    closeDatabase(restarted)
  })

  it('フェーズ5.1（projectsまで）→ 現在: tasks.project_id を追加し、タスク・プロジェクト・Workspace設定を保持する', () => {
    const dbFile = join(temp.dir, 'gtd.sqlite')
    const oldMigrations = join(temp.dir, 'migrations-phase51')
    createPartialMigrations(oldMigrations, 4)
    const projectId = '33333333-3333-4333-8333-333333333333'
    const workspaceValue = JSON.stringify({
      version: 1,
      sidebarWidth: 260,
      detailWidth: 340,
      detailVisible: true,
      lastRoute: `/projects/${projectId}`
    })
    const projectRows = [
      { id: projectId, name: '仕事', at: '2026-11-09T04:00:00.000Z', doneOn: null },
      { id: '44444444-4444-4444-8444-444444444444', name: '完了済み', at: '2026-11-09T04:30:00.000Z', doneOn: '2026-11-09T06:00:00.000Z' }
    ]

    const old = openDatabase(dbFile)
    expect(runMigrations(old, oldMigrations)).toEqual({ appliedBefore: 0, appliedAfter: 4 })
    insertOldTasks(old)
    old.$client.prepare('UPDATE tasks SET completed_at = ? WHERE id = ?').run('2026-11-09T05:00:00.000Z', oldTasks[1]?.id)
    const insertProject = old.$client.prepare(
      'INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?)'
    )
    for (const project of projectRows) insertProject.run(project.id, project.name, project.at, project.at, project.doneOn)
    createSettingsRepository(old).upsert({ key: 'workspace', value: workspaceValue, updatedAt: '2026-11-09T03:00:00.000Z' })
    const beforeTasks = readOldTasks(old)
    const beforeProjects = old.$client.prepare('SELECT * FROM projects ORDER BY id').all()
    closeDatabase(old)

    const upgraded = openDatabase(dbFile)
    expect(runMigrations(upgraded, MIGRATIONS_DIR)).toEqual({ appliedBefore: 4, appliedAfter: MIGRATION_COUNT })
    // 既存タスクはID・タイトル・日時・完了日時を保持し、未所属（projectId = null）になる
    expect(createTaskRepository(upgraded).listAll()).toEqual((/* 049-important-default */ (beforeTasks.map((task) => ({ ...task, projectId: null, milestoneId: null, hiddenAt: null, position: null, dueto: null, favorite: false })))).map((row) => ({ ...row, important: false })))
    // 0010: completed_at → done_on（値・updated_at はそのまま）、done は完了日時の有無から
    expect(upgraded.$client.prepare('SELECT * FROM projects ORDER BY id').all()).toEqual(
      ((beforeProjects as Record<string, unknown>[]).map(({ completed_at: doneOn, ...rest }) => ({ ...rest, done_on: doneOn, done: doneOn === null ? 0 : 1 }))).map((row) => ({ ...row, favorite: 0 }))
    )
    expect(createSettingsRepository(upgraded).get('workspace')?.value).toBe(workspaceValue)

    // 外部キー（projects.id）と索引
    expect(upgraded.$client.prepare('PRAGMA foreign_key_list(tasks)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'projects', from: 'project_id', to: 'id' })])
    )
    const indexes = upgraded.$client.prepare('PRAGMA index_list(tasks)').all() as { name: string }[]
    expect(indexes.map((index) => index.name)).toContain('tasks_project_id_idx')
    expect(upgraded.$client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(() =>
      upgraded.$client
        .prepare('UPDATE tasks SET project_id = ? WHERE id = ?')
        .run('55555555-5555-4555-8555-555555555555', oldTasks[0]?.id)
    ).toThrow(/FOREIGN KEY/)
    closeDatabase(upgraded)

    const restarted = openDatabase(dbFile)
    expect(runMigrations(restarted, MIGRATIONS_DIR)).toEqual({
      appliedBefore: MIGRATION_COUNT,
      appliedAfter: MIGRATION_COUNT
    })
    expect(createTaskRepository(restarted).listAll()).toEqual((/* 051-important-restart-default */ (beforeTasks.map((task) => ({ ...task, projectId: null, milestoneId: null, hiddenAt: null, position: null, dueto: null, favorite: false })))).map((row) => ({ ...row, important: false })))
    closeDatabase(restarted)
  })
})
