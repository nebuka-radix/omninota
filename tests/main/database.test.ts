import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createTaskService } from '../../src/main/services/task-service'
import { createTempDir, MIGRATION_COUNT, MIGRATIONS_DIR, taskServiceDeps } from '../helpers/temp-database'

describe('DB・マイグレーション・Repository（ホストNode.js）', () => {
  let temp: ReturnType<typeof createTempDir>
  let dbFile: string
  const opened: AppDatabase[] = []

  const open = () => {
    const db = openDatabase(dbFile)
    opened.push(db)
    return db
  }

  beforeEach(() => {
    temp = createTempDir()
    dbFile = join(temp.dir, 'nested', 'gtd.sqlite')
  })

  afterEach(() => {
    opened.splice(0).forEach(closeDatabase)
    temp.cleanup()
  })

  it('DBファイルを作成し、接続設定を適用する', () => {
    const db = open()
    expect(db.$client.pragma('journal_mode', { simple: true })).toBe('wal')
    expect(db.$client.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.$client.pragma('synchronous', { simple: true })).toBe(2) // FULL
  })

  it('全マイグレーションを適用し、再実行しても重複適用しない', () => {
    const total = MIGRATION_COUNT
    const db = open()
    expect(runMigrations(db, MIGRATIONS_DIR)).toEqual({ appliedBefore: 0, appliedAfter: total })
    expect(runMigrations(db, MIGRATIONS_DIR)).toEqual({ appliedBefore: total, appliedAfter: total })
    closeDatabase(db)

    const reopened = open()
    expect(runMigrations(reopened, MIGRATIONS_DIR)).toEqual({ appliedBefore: total, appliedAfter: total })
  })

  it('マイグレーションファイルがない場合は例外にし、DBを削除しない', () => {
    const db = open()
    expect(() => runMigrations(db, join(temp.dir, 'missing'))).toThrow(/マイグレーションファイルが見つかりません/)
    expect(db.$client.open).toBe(true)
  })

  it('登録したタスクを取得でき、再接続後も残る', () => {
    const db = open()
    runMigrations(db, MIGRATIONS_DIR)
    const service = createTaskService({
      ...taskServiceDeps(db),
      now: () => new Date('2026-11-09T01:02:03.004Z'),
      generateId: () => 'id-1'
    })
    const created = service.create({ title: '牛乳を買う' })
    expect(created).toEqual({
      id: 'id-1',
      title: '牛乳を買う',
      projectId: null,
      createdAt: '2026-11-09T01:02:03.004Z',
      updatedAt: '2026-11-09T01:02:03.004Z',
      completedAt: null
    })
    closeDatabase(db)

    const reopened = open()
    runMigrations(reopened, MIGRATIONS_DIR)
    expect(createTaskRepository(reopened).listAll()).toEqual([created])
  })

  it('一覧は作成日時の新しい順で、同じ日時ならidの降順で安定する', () => {
    const db = open()
    runMigrations(db, MIGRATIONS_DIR)
    const repository = createTaskRepository(db)
    const row = (id: string, createdAt: string) => ({ id, title: id, createdAt, updatedAt: createdAt })
    // 挿入順を時刻順・id順とずらしておく
    repository.insert(row('b', '2026-11-09T00:00:00.000Z'))
    repository.insert(row('c', '2026-11-09T00:00:01.000Z'))
    repository.insert(row('a', '2026-11-09T00:00:00.000Z'))
    repository.insert(row('d', '2026-11-08T23:59:59.999Z'))

    const ids = () => repository.listAll().map((task) => task.id)
    expect(ids()).toEqual(['c', 'b', 'a', 'd'])
    expect(ids()).toEqual(ids())
  })
})
