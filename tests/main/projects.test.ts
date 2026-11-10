import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createIpcHandler, type InvokeEventLike, type SenderPolicy } from '../../src/main/ipc/handler'
import { createProjectRepository } from '../../src/main/repositories/project-repository'
import { createProjectService, type ProjectService } from '../../src/main/services/project-service'
import { PROJECT_NAME_MAX_LENGTH } from '../../src/shared/contracts/projects'
import { TASK_TITLE_MAX_LENGTH } from '../../src/shared/contracts/tasks'
import {
  projectsCreateArgsSchema,
  projectsListArgsSchema,
  projectsRenameArgsSchema
} from '../../src/shared/validation/projects'
import { createTempDir, MIGRATIONS_DIR, projectServiceDeps } from '../helpers/temp-database'

const MISSING_ID = '00000000-0000-4000-8000-000000000000'

function createClock(start = '2026-11-09T00:00:00.000Z') {
  let current = new Date(start).getTime()
  return () => {
    const value = new Date(current)
    current += 1000
    return value
  }
}

describe('プロジェクト名の入力検証', () => {
  it('前後の空白を除去する', () => {
    const result = projectsCreateArgsSchema.safeParse([{ name: '  仕事  ' }])
    expect(result.success && result.data[0].name).toBe('仕事')
  })

  it.each([[''], ['   '], ['\n\t　']])('空白だけの名前 %j を拒否する', (name) => {
    const result = projectsCreateArgsSchema.safeParse([{ name }])
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('プロジェクト名を入力してください。')
  })

  it('上限ちょうどは許可し、超えたら拒否する（前後空白は除去後に数える）', () => {
    expect(projectsCreateArgsSchema.safeParse([{ name: 'あ'.repeat(PROJECT_NAME_MAX_LENGTH) }]).success).toBe(true)
    expect(projectsCreateArgsSchema.safeParse([{ name: ` ${'a'.repeat(PROJECT_NAME_MAX_LENGTH)} ` }]).success).toBe(true)
    expect(projectsCreateArgsSchema.safeParse([{ name: 'a'.repeat(PROJECT_NAME_MAX_LENGTH + 1) }]).success).toBe(false)
  })

  it('プロジェクト名とタスク名の上限は別の定数（現在の値は同じ）', () => {
    expect(PROJECT_NAME_MAX_LENGTH).toBe(200)
    expect(TASK_TITLE_MAX_LENGTH).toBe(200)
  })

  it.each<[string, unknown[]]>([
    ['引数なし', []],
    ['余分なキー', [{ name: 'a', completedAt: '2026-01-01T00:00:00.000Z' }]],
    ['文字列以外', [{ name: 1 }]],
    ['余分な引数', [{ name: 'a' }, { name: 'b' }]]
  ])('作成: 不正な形（%s）を拒否する', (_label, args) => {
    expect(projectsCreateArgsSchema.safeParse(args).success).toBe(false)
  })

  it.each<[string, unknown[]]>([
    ['UUIDでないID', [{ id: 'x', name: 'a' }]],
    ['名前なし', [{ id: MISSING_ID }]],
    ['空白だけの名前', [{ id: MISSING_ID, name: ' ' }]]
  ])('名前変更: 不正な形（%s）を拒否する', (_label, args) => {
    expect(projectsRenameArgsSchema.safeParse(args).success).toBe(false)
  })

  it('一覧は引数を受け付けない', () => {
    expect(projectsListArgsSchema.safeParse([]).success).toBe(true)
    expect(projectsListArgsSchema.safeParse([{}]).success).toBe(false)
  })
})

describe('プロジェクトの保存（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let dbFile: string
  let db: AppDatabase
  let service: ProjectService
  let n = 0

  beforeEach(() => {
    temp = createTempDir()
    dbFile = join(temp.dir, 'gtd.sqlite')
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    n = 0
    service = createProjectService({
      ...projectServiceDeps(db),
      now: createClock(),
      generateId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
    })
  })

  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  it('未完了（completedAt = null）で作成し、日時とIDはMain側で付与する', () => {
    const created = service.create({ name: '仕事' })
    expect(created).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      name: '仕事',
      createdAt: '2026-11-09T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:00.000Z',
      completedAt: null
    })
  })

  it('同名のプロジェクトを作成できる', () => {
    service.create({ name: '仕事' })
    service.create({ name: '仕事' })
    expect(service.list().map((project) => project.name)).toEqual(['仕事', '仕事'])
  })

  it('名前を変更するとupdatedAtだけが変わり、同じ名前なら更新しない', () => {
    const created = service.create({ name: '旧' })
    const renamed = service.rename({ id: created.id, name: '新' })
    expect(renamed).toMatchObject({ name: '新', createdAt: created.createdAt, completedAt: null })
    expect(renamed.updatedAt > created.updatedAt).toBe(true)
    expect(service.rename({ id: created.id, name: '新' })).toEqual(renamed)
  })

  it('前後に空白を付けただけの同じ名前は、入力検証で除去された後に「変更なし」として扱い更新しない', () => {
    const created = service.create({ name: '仕事' })
    const parsed = projectsRenameArgsSchema.parse([{ id: created.id, name: '  仕事 ' }])
    expect(service.rename(parsed[0])).toEqual(created)
    expect(createProjectRepository(db).findById(created.id)?.updatedAt).toBe(created.updatedAt)
  })

  it('DBからの一覧は作成日時・IDの昇順（名前変更や挿入順に左右されない）', () => {
    const fixed = createProjectService({
      ...projectServiceDeps(db),
      now: () => new Date('2026-11-09T00:00:00.000Z'),
      generateId: (() => {
        const ids = ['00000000-0000-4000-8000-00000000000c', '00000000-0000-4000-8000-00000000000a']
        return () => ids.shift() ?? MISSING_ID
      })()
    })
    const later = service.create({ name: '後' }) // 2026-11-09T00:00:00Z（clockの1件目）
    fixed.create({ name: 'C' })
    fixed.create({ name: 'A' })
    service.rename({ id: later.id, name: 'Z' })
    expect(service.list().map((project) => project.id)).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-00000000000a',
      '00000000-0000-4000-8000-00000000000c'
    ])
  })

  it('存在しないIDの名前変更は NOT_FOUND', () => {
    expect(() => service.rename({ id: MISSING_ID, name: 'x' })).toThrow(/プロジェクトが見つかりません/)
  })

  it('再接続後も作成・名前変更の内容が復元される', () => {
    const created = service.create({ name: 'a' })
    const renamed = service.rename({ id: created.id, name: 'b' })
    closeDatabase(db)
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    expect(createProjectRepository(db).listAll()).toEqual([renamed])
  })

  it('IPCハンドラー経由: 不正入力はINVALID_INPUT、存在しないIDはNOT_FOUND（内部の詳細は返さない）', async () => {
    const policy: SenderPolicy = {
      getWindow: () => ({ isDestroyed: () => false, webContents: { id: 1 } }),
      isAllowedUrl: () => true
    }
    const event: InvokeEventLike = { sender: { id: 1 }, senderFrame: { url: 'file:///index.html', parent: null } }
    const logger = { warn: vi.fn(), error: vi.fn() }
    const rename = createIpcHandler({
      channel: 'projects:rename',
      argsSchema: projectsRenameArgsSchema,
      policy,
      logger,
      run: ([input]) => service.rename(input)
    })
    expect(await rename(event, { id: MISSING_ID, name: '   ' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await rename(event, { id: MISSING_ID, name: 'x' })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: '対象のプロジェクトが見つかりません。' }
    })
    expect(logger.error).not.toHaveBeenCalled()
  })
})
