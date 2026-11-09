import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createIpcHandler, type InvokeEventLike, type SenderPolicy } from '../../src/main/ipc/handler'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import { TASK_TITLE_MAX_LENGTH } from '../../src/shared/contracts/tasks'
import {
  tasksSetCompletedArgsSchema,
  tasksUpdateTitleArgsSchema
} from '../../src/shared/validation/tasks'
import { createTempDir, MIGRATIONS_DIR } from '../helpers/temp-database'

const ID = '6f1c2f8e-3c1d-4f0a-9b7e-2a6d1f3c9e10'
const MISSING_ID = '00000000-0000-4000-8000-000000000000'

// 呼び出しごとに1秒進む時計（日時の更新有無を確かめるため）
function createClock(start = '2026-11-09T00:00:00.000Z') {
  let current = new Date(start).getTime()
  return () => {
    const value = new Date(current)
    current += 1000
    return value
  }
}

describe('タスクの更新（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let dbFile: string
  let db: AppDatabase
  let service: TaskService

  beforeEach(() => {
    temp = createTempDir()
    dbFile = join(temp.dir, 'gtd.sqlite')
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    service = createTaskService({ repository: createTaskRepository(db), now: createClock(), generateId: () => ID })
  })

  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  it('新規タスクは未完了（completedAt = null）', () => {
    const created = service.create({ title: '牛乳を買う' })
    expect(created.completedAt).toBeNull()
    expect(service.list()[0]?.completedAt).toBeNull()
  })

  it('タイトルを編集するとupdatedAtだけが変わる（作成日時・完了日時は変えない）', () => {
    const created = service.create({ title: '旧タイトル' })
    const updated = service.updateTitle({ id: ID, title: '新タイトル' })
    expect(updated.title).toBe('新タイトル')
    expect(updated.createdAt).toBe(created.createdAt)
    expect(updated.completedAt).toBeNull()
    expect(updated.updatedAt > created.updatedAt).toBe(true)
    expect(service.list()[0]).toEqual(updated)
  })

  it('保存済みと同じタイトルなら更新しない（updatedAtを変えない）', () => {
    const created = service.create({ title: '同じ' })
    expect(service.updateTitle({ id: ID, title: '同じ' })).toEqual(created)
  })

  it('完了するとcompletedAtとupdatedAtが同じ日時になり、作成日時は変わらない', () => {
    const created = service.create({ title: 'a' })
    const done = service.setCompleted({ id: ID, completed: true })
    expect(done.completedAt).not.toBeNull()
    expect(done.updatedAt).toBe(done.completedAt)
    expect(done.createdAt).toBe(created.createdAt)
  })

  it('既に完了しているタスクへの完了要求では日時を変えない（トグルしない）', () => {
    service.create({ title: 'a' })
    const done = service.setCompleted({ id: ID, completed: true })
    expect(service.setCompleted({ id: ID, completed: true })).toEqual(done)
  })

  it('完了を取り消すとcompletedAtがnullになり、updatedAtが進む', () => {
    service.create({ title: 'a' })
    const done = service.setCompleted({ id: ID, completed: true })
    const reopened = service.setCompleted({ id: ID, completed: false })
    expect(reopened.completedAt).toBeNull()
    expect(reopened.updatedAt > done.updatedAt).toBe(true)
    // 未完了への再要求でも日時を変えない
    expect(service.setCompleted({ id: ID, completed: false })).toEqual(reopened)
  })

  it('完了済みタスクのタイトルを編集しても完了日時は変わらない', () => {
    service.create({ title: 'a' })
    const done = service.setCompleted({ id: ID, completed: true })
    expect(service.updateTitle({ id: ID, title: 'b' }).completedAt).toBe(done.completedAt)
  })

  it('存在しないIDは成功扱いしない（NOT_FOUND）', () => {
    expect(() => service.updateTitle({ id: MISSING_ID, title: 'x' })).toThrow(/見つかりません/)
    expect(() => service.setCompleted({ id: MISSING_ID, completed: true })).toThrow(/見つかりません/)
  })

  it('再接続後も編集・完了の内容が復元される', () => {
    service.create({ title: 'a' })
    service.updateTitle({ id: ID, title: '編集後' })
    const done = service.setCompleted({ id: ID, completed: true })
    closeDatabase(db)
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    expect(createTaskRepository(db).findById(ID)).toEqual({ ...done, title: '編集後' })
  })
})

describe('タスク更新APIの入力検証とエラー（IPCハンドラー）', () => {
  let temp: ReturnType<typeof createTempDir>
  let db: AppDatabase
  let service: TaskService
  const logger = { warn: vi.fn(), error: vi.fn() }
  const policy: SenderPolicy = {
    getWindow: () => ({ isDestroyed: () => false, webContents: { id: 1 } }),
    isAllowedUrl: () => true
  }
  const event: InvokeEventLike = { sender: { id: 1 }, senderFrame: { url: 'file:///index.html', parent: null } }

  beforeEach(() => {
    temp = createTempDir()
    db = openDatabase(join(temp.dir, 'gtd.sqlite'))
    runMigrations(db, MIGRATIONS_DIR)
    service = createTaskService({ repository: createTaskRepository(db), generateId: () => ID })
    service.create({ title: '元のタイトル' })
    logger.warn.mockClear()
    logger.error.mockClear()
  })

  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  const updateTitle = () =>
    createIpcHandler({
      channel: 'tasks:update-title',
      argsSchema: tasksUpdateTitleArgsSchema,
      policy,
      logger,
      run: ([input]) => service.updateTitle(input)
    })
  const setCompleted = () =>
    createIpcHandler({
      channel: 'tasks:set-completed',
      argsSchema: tasksSetCompletedArgsSchema,
      policy,
      logger,
      run: ([input]) => service.setCompleted(input)
    })

  it('成功時は保存後のタスクを返す（タイトルは前後空白を除去）', async () => {
    const result = await updateTitle()(event, { id: ID, title: '  新しい  ' })
    expect(result).toMatchObject({ ok: true, data: { id: ID, title: '新しい' } })
    expect(await setCompleted()(event, { id: ID, completed: true })).toMatchObject({ ok: true, data: { id: ID } })
  })

  it.each<[string, unknown[]]>([
    ['空白だけのタイトル', [{ id: ID, title: '   ' }]],
    ['上限超過のタイトル', [{ id: ID, title: 'x'.repeat(TASK_TITLE_MAX_LENGTH + 1) }]],
    ['UUIDでないID', [{ id: '1; DROP TABLE tasks', title: 'x' }]],
    ['余分なキー（列の直接指定）', [{ id: ID, title: 'x', completedAt: '2026-01-01T00:00:00.000Z' }]],
    ['引数なし', []]
  ])('タイトル更新: %s はINVALID_INPUTで、DBは変わらない', async (_label, args) => {
    expect(await updateTitle()(event, ...args)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(service.list()[0]?.title).toBe('元のタイトル')
  })

  it.each<[string, unknown[]]>([
    ['completedが文字列', [{ id: ID, completed: 'true' }]],
    ['完了日時の指定', [{ id: ID, completed: true, completedAt: '2020-01-01T00:00:00.000Z' }]],
    ['completedなし（トグル要求）', [{ id: ID }]]
  ])('完了状態の更新: %s はINVALID_INPUT', async (_label, args) => {
    expect(await setCompleted()(event, ...args)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(service.list()[0]?.completedAt).toBeNull()
  })

  it('存在しないIDはNOT_FOUND（SQLや内部の詳細は返さない）', async () => {
    const result = await setCompleted()(event, { id: MISSING_ID, completed: true })
    expect(result).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: '対象のタスクが見つかりません。' } })
    expect(logger.error).not.toHaveBeenCalled()
  })
})
