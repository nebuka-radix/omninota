import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createIpcHandler, type InvokeEventLike, type SenderPolicy } from '../../src/main/ipc/handler'
import { createProjectRepository } from '../../src/main/repositories/project-repository'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createProjectService, type ProjectService } from '../../src/main/services/project-service'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import {
  tasksCreateArgsSchema,
  tasksSetProjectArgsSchema
} from '../../src/shared/validation/tasks'
import { createTempDir, MIGRATIONS_DIR, taskServiceDeps } from '../helpers/temp-database'

const MISSING_ID = '00000000-0000-4000-8000-00000000ffff'

function createClock(start = '2026-11-10T00:00:00.000Z') {
  let current = new Date(start).getTime()
  return () => {
    const value = new Date(current)
    current += 1000
    return value
  }
}

describe('タスクの所属（入力検証）', () => {
  const projectId = '00000000-0000-4000-8000-000000000001'

  it('作成: projectId は省略可（従来の呼び出しと互換。未所属）、null、UUIDを受け付ける', () => {
    expect(tasksCreateArgsSchema.parse([{ title: 'a' }])[0]).toEqual({ title: 'a' })
    expect(tasksCreateArgsSchema.parse([{ title: 'a', projectId: null }])[0]).toEqual({ title: 'a', projectId: null })
    expect(tasksCreateArgsSchema.parse([{ title: 'a', projectId }])[0]).toEqual({ title: 'a', projectId })
  })

  it.each<[string, unknown[]]>([
    ['UUIDでないprojectId', [{ title: 'a', projectId: 'x' }]],
    ['数値のprojectId', [{ title: 'a', projectId: 1 }]],
    ['余分なキー', [{ title: 'a', projectId, completedAt: null }]]
  ])('作成: 不正な形（%s）を拒否する', (_label, args) => {
    expect(tasksCreateArgsSchema.safeParse(args).success).toBe(false)
  })

  it.each<[string, unknown[]]>([
    ['projectIdの省略（解除はnullで明示する）', [{ id: projectId }]],
    ['UUIDでないタスクID', [{ id: 'x', projectId: null }]],
    ['UUIDでないprojectId', [{ id: projectId, projectId: 'x' }]],
    ['余分なキー', [{ id: projectId, projectId: null, title: 'a' }]],
    ['引数なし', []]
  ])('所属変更: 不正な形（%s）を拒否する', (_label, args) => {
    expect(tasksSetProjectArgsSchema.safeParse(args).success).toBe(false)
  })
})

describe('タスクの所属（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let dbFile: string
  let db: AppDatabase
  let tasks: TaskService
  let projects: ProjectService
  let n = 0

  const complete = (projectId: string) =>
    db.$client.prepare('UPDATE projects SET completed_at = ? WHERE id = ?').run('2026-11-10T09:00:00.000Z', projectId)

  beforeEach(() => {
    temp = createTempDir()
    dbFile = join(temp.dir, 'gtd.sqlite')
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    n = 0
    const now = createClock()
    const generateId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
    tasks = createTaskService({ ...taskServiceDeps(db), now, generateId })
    projects = createProjectService({ repository: createProjectRepository(db), now, generateId })
  })

  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  it('projectIdを省略・nullで作成すると未所属', () => {
    expect(tasks.create({ title: 'a' }).projectId).toBeNull()
    expect(tasks.create({ title: 'b', projectId: null }).projectId).toBeNull()
  })

  it('プロジェクトを指定して作成できる', () => {
    const project = projects.create({ name: '仕事' })
    const task = tasks.create({ title: '資料', projectId: project.id })
    expect(task).toMatchObject({ title: '資料', projectId: project.id, completedAt: null })
    expect(createTaskRepository(db).findById(task.id)?.projectId).toBe(project.id)
  })

  it('存在しないプロジェクトを指定した作成は NOT_FOUND（タスクは作らない）', () => {
    expect(() => tasks.create({ title: 'a', projectId: MISSING_ID })).toThrow(/指定したプロジェクトが見つかりません/)
    expect(tasks.list()).toEqual([])
  })

  it('完了済みプロジェクトへの作成は CONFLICT（タスクは作らない）', () => {
    const project = projects.create({ name: '完了済み' })
    complete(project.id)
    expect(() => tasks.create({ title: 'a', projectId: project.id })).toThrow(
      expect.objectContaining({ code: 'CONFLICT' })
    )
    expect(tasks.list()).toEqual([])
  })

  it('所属の変更・解除: updatedAtだけを更新し、ID・タイトル・作成日時・完了日時は変えない', () => {
    const a = projects.create({ name: 'A' })
    const b = projects.create({ name: 'B' })
    const created = tasks.create({ title: 'タスク' })
    const done = tasks.setCompleted({ id: created.id, completed: true })

    const toA = tasks.setProject({ id: created.id, projectId: a.id })
    expect(toA).toEqual({ ...done, projectId: a.id, updatedAt: toA.updatedAt })
    expect(toA.updatedAt > done.updatedAt).toBe(true)

    const toB = tasks.setProject({ id: created.id, projectId: b.id })
    expect(toB).toMatchObject({ id: created.id, title: 'タスク', createdAt: created.createdAt, completedAt: done.completedAt, projectId: b.id })
    expect(toB.updatedAt > toA.updatedAt).toBe(true)

    const unassigned = tasks.setProject({ id: created.id, projectId: null })
    expect(unassigned).toMatchObject({ projectId: null, completedAt: done.completedAt, createdAt: created.createdAt })
    expect(unassigned.updatedAt > toB.updatedAt).toBe(true)
  })

  it('同じ所属への再要求は変更なしの成功（updatedAtも変えない）', () => {
    const a = projects.create({ name: 'A' })
    const task = tasks.create({ title: 't', projectId: a.id })
    expect(tasks.setProject({ id: task.id, projectId: a.id })).toEqual(task)
    const inbox = tasks.create({ title: 'u' })
    expect(tasks.setProject({ id: inbox.id, projectId: null })).toEqual(inbox)
  })

  it('完了済みプロジェクトに既に所属している場合、同じ所属の再要求はエラーにも更新にもならない', () => {
    const a = projects.create({ name: 'A' })
    const task = tasks.create({ title: 't', projectId: a.id })
    complete(a.id)
    expect(tasks.setProject({ id: task.id, projectId: a.id })).toEqual(task)
  })

  it('完了済みプロジェクトへの移動は CONFLICT（所属・updatedAtは変えない）', () => {
    const done = projects.create({ name: '完了済み' })
    complete(done.id)
    const task = tasks.create({ title: 't' })
    expect(() => tasks.setProject({ id: task.id, projectId: done.id })).toThrow(
      expect.objectContaining({ code: 'CONFLICT', message: '完了済みのプロジェクトにはタスクを追加・移動できません。' })
    )
    expect(createTaskRepository(db).findById(task.id)).toMatchObject({ projectId: null, updatedAt: task.updatedAt })
  })

  it('完了済みプロジェクトから、未所属・別の未完了プロジェクトへの移動は許可する', () => {
    const done = projects.create({ name: '完了済み' })
    const open = projects.create({ name: '未完了' })
    const t1 = tasks.create({ title: 't1', projectId: done.id })
    const t2 = tasks.create({ title: 't2', projectId: done.id })
    complete(done.id)
    expect(tasks.setProject({ id: t1.id, projectId: null }).projectId).toBeNull()
    expect(tasks.setProject({ id: t2.id, projectId: open.id }).projectId).toBe(open.id)
  })

  it('存在しないタスクは NOT_FOUND（タスク）、存在しない移動先は NOT_FOUND（プロジェクト）', () => {
    expect(() => tasks.setProject({ id: MISSING_ID, projectId: null })).toThrow(/対象のタスクが見つかりません/)
    const task = tasks.create({ title: 't' })
    expect(() => tasks.setProject({ id: task.id, projectId: MISSING_ID })).toThrow(/指定したプロジェクトが見つかりません/)
    expect(createTaskRepository(db).findById(task.id)?.projectId).toBeNull()
  })

  it('タイトル・完了状態の更新では所属を変えない', () => {
    const a = projects.create({ name: 'A' })
    const task = tasks.create({ title: 't', projectId: a.id })
    expect(tasks.updateTitle({ id: task.id, title: 'u' }).projectId).toBe(a.id)
    expect(tasks.setCompleted({ id: task.id, completed: true }).projectId).toBe(a.id)
  })

  it('外部キー: 存在しないプロジェクトIDはDBでも保存できない', () => {
    const task = tasks.create({ title: 't' })
    expect(() => createTaskRepository(db).updateProjectId(task.id, MISSING_ID, '2026-11-10T10:00:00.000Z')).toThrow(
      /FOREIGN KEY/
    )
  })

  it('確認と更新は1つのトランザクション: 更新に失敗したら確認だけが残ることはない', () => {
    const a = projects.create({ name: 'A' })
    const task = tasks.create({ title: 't' })
    const failing = createTaskService({
      ...taskServiceDeps(db),
      repository: {
        ...createTaskRepository(db),
        updateProjectId: () => {
          db.$client.prepare('UPDATE tasks SET title = ? WHERE id = ?').run('途中の変更', task.id)
          throw new Error('書き込み失敗')
        }
      }
    })
    expect(() => failing.setProject({ id: task.id, projectId: a.id })).toThrow('書き込み失敗')
    // 同じトランザクション内の変更はROLLBACKされる
    expect(createTaskRepository(db).findById(task.id)).toMatchObject({ title: 't', projectId: null })
  })

  it('再接続後も所属が復元される', () => {
    const a = projects.create({ name: 'A' })
    const t1 = tasks.create({ title: 't1', projectId: a.id })
    const t2 = tasks.setProject({ id: tasks.create({ title: 't2' }).id, projectId: a.id })
    closeDatabase(db)
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    const restored = createTaskRepository(db).listAll()
    expect(restored.map((task) => [task.id, task.projectId]).sort()).toEqual([
      [t1.id, a.id],
      [t2.id, a.id]
    ].sort())
  })

  it('IPCハンドラー経由: 不正入力はINVALID_INPUT、存在しないのはNOT_FOUND、完了済みはCONFLICT', async () => {
    const policy: SenderPolicy = {
      getWindow: () => ({ isDestroyed: () => false, webContents: { id: 1 } }),
      isAllowedUrl: () => true
    }
    const event: InvokeEventLike = { sender: { id: 1 }, senderFrame: { url: 'file:///index.html', parent: null } }
    const logger = { warn: vi.fn(), error: vi.fn() }
    const setProject = createIpcHandler({
      channel: 'tasks:set-project',
      argsSchema: tasksSetProjectArgsSchema,
      policy,
      logger,
      run: ([input]) => tasks.setProject(input)
    })
    const create = createIpcHandler({
      channel: 'tasks:create',
      argsSchema: tasksCreateArgsSchema,
      policy,
      logger,
      run: ([input]) => tasks.create(input)
    })
    const done = projects.create({ name: '完了済み' })
    complete(done.id)
    const task = tasks.create({ title: 't' })

    expect(await setProject(event, { id: task.id, projectId: 'x' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await setProject(event, { id: MISSING_ID, projectId: null })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: '対象のタスクが見つかりません。' }
    })
    expect(await setProject(event, { id: task.id, projectId: MISSING_ID })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: '指定したプロジェクトが見つかりません。' }
    })
    expect(await setProject(event, { id: task.id, projectId: done.id })).toEqual({
      ok: false,
      error: { code: 'CONFLICT', message: '完了済みのプロジェクトにはタスクを追加・移動できません。' }
    })
    expect(await create(event, { title: 'x', projectId: done.id })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await create(event, { title: 'x' })).toMatchObject({ ok: true, data: { projectId: null } })
    expect(logger.error).not.toHaveBeenCalled()
  })
})
