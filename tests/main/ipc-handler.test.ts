import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createIpcHandler, isTrustedSender, type InvokeEventLike, type SenderPolicy } from '../../src/main/ipc/handler'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import { tasksCreateArgsSchema, tasksListArgsSchema } from '../../src/shared/validation/tasks'
import { createTempDir, MIGRATIONS_DIR } from '../helpers/temp-database'

const APP_URL = 'file:///app/out/renderer/index.html#/inbox'
const WINDOW_ID = 7

const policy: SenderPolicy = {
  getWindow: () => ({ isDestroyed: () => false, webContents: { id: WINDOW_ID } }),
  isAllowedUrl: (url) => url.startsWith('file:///app/out/renderer/index.html')
}

const trustedEvent: InvokeEventLike = { sender: { id: WINDOW_ID }, senderFrame: { url: APP_URL, parent: null } }

describe('IPC送信元の検証', () => {
  it('自アプリのウィンドウのメインフレームだけを許可する', () => {
    expect(isTrustedSender(trustedEvent, policy)).toBe(true)
  })

  it.each<[string, InvokeEventLike, SenderPolicy?]>([
    ['別のwebContents', { ...trustedEvent, sender: { id: 99 } }],
    ['フレームなし', { ...trustedEvent, senderFrame: null }],
    ['子フレーム', { ...trustedEvent, senderFrame: { url: APP_URL, parent: {} } }],
    ['許可外のURL', { ...trustedEvent, senderFrame: { url: 'https://example.com/', parent: null } }],
    ['ウィンドウなし', trustedEvent, { ...policy, getWindow: () => null }],
    [
      '破棄済みのウィンドウ',
      trustedEvent,
      { ...policy, getWindow: () => ({ isDestroyed: () => true, webContents: { id: WINDOW_ID } }) }
    ]
  ])('拒否する: %s', (_label, event, customPolicy) => {
    expect(isTrustedSender(event, customPolicy ?? policy)).toBe(false)
  })
})

describe('Main側のIPCハンドラー（tasks.create / tasks.list）', () => {
  let temp: ReturnType<typeof createTempDir>
  let db: AppDatabase
  let service: TaskService
  const logger = { warn: vi.fn(), error: vi.fn() }

  beforeEach(() => {
    temp = createTempDir()
    db = openDatabase(join(temp.dir, 'gtd.sqlite'))
    runMigrations(db, MIGRATIONS_DIR)
    service = createTaskService({ repository: createTaskRepository(db) })
    logger.warn.mockClear()
    logger.error.mockClear()
  })

  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  const createHandler = (run: Parameters<typeof createIpcHandler<typeof tasksCreateArgsSchema, unknown>>[0]['run']) =>
    createIpcHandler({ channel: 'tasks:create', argsSchema: tasksCreateArgsSchema, policy, logger, run })

  it('正しい入力を保存し、前後空白を除去したタイトルを返す', async () => {
    const handler = createHandler(([input]) => service.create(input))
    const result = await handler(trustedEvent, { title: '  書類を出す  ' })
    expect(result.ok).toBe(true)
    expect(result.ok && result.data).toMatchObject({ title: '書類を出す' })
    expect(service.list().map((task) => task.title)).toEqual(['書類を出す'])
  })

  it.each([
    ['空白だけのタイトル', [{ title: '   ' }], 'タイトルを入力してください。'],
    ['引数なし', [], undefined],
    ['余分なキー', [{ title: 'a', extra: true }], undefined],
    ['余分な引数', [{ title: 'a' }, { title: 'b' }], undefined]
  ])('入力エラー（%s）はINVALID_INPUTを返し、保存しない', async (_label, args, message) => {
    const run = vi.fn(([input]: [{ title: string }]) => service.create(input))
    const handler = createHandler(run)
    const result = await handler(trustedEvent, ...args)
    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    if (message && !result.ok) expect(result.error.message).toBe(message)
    expect(run).not.toHaveBeenCalled()
    expect(service.list()).toEqual([])
  })

  it('信頼できない送信元はFORBIDDENを返し、処理を呼ばない', async () => {
    const run = vi.fn()
    const handler = createHandler(run)
    const result = await handler({ ...trustedEvent, sender: { id: 1 } }, { title: 'a' })
    expect(result).toEqual({ ok: false, error: { code: 'FORBIDDEN', message: '許可されていない呼び出しです。' } })
    expect(run).not.toHaveBeenCalled()
  })

  it('DBエラーの詳細やスタックをRendererへ返さない', async () => {
    closeDatabase(db) // 接続を閉じてDB操作を失敗させる
    const handler = createIpcHandler({
      channel: 'tasks:list',
      argsSchema: tasksListArgsSchema,
      policy,
      logger,
      run: () => service.list()
    })
    const result = await handler(trustedEvent)
    expect(result).toEqual({ ok: false, error: { code: 'INTERNAL', message: '処理中にエラーが発生しました。' } })
    expect(JSON.stringify(result)).not.toMatch(/database|sqlite|stack|at /i)
    expect(logger.error).toHaveBeenCalledTimes(1)
  })
})
