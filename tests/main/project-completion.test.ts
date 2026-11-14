import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createIpcHandler, type InvokeEventLike, type SenderPolicy } from '../../src/main/ipc/handler'
import { createProjectRepository } from '../../src/main/repositories/project-repository'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createProjectService, type ProjectService } from '../../src/main/services/project-service'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import { projectsSetCompletedArgsSchema } from '../../src/shared/validation/projects'
import { createTempDir, inProject, MIGRATIONS_DIR, projectServiceDeps, taskServiceDeps } from '../helpers/temp-database'

const MISSING_ID = '00000000-0000-4000-8000-00000000ffff'

function createClock(start = '2026-11-10T00:00:00.000Z') {
  let current = new Date(start).getTime()
  return () => {
    const value = new Date(current)
    current += 1000
    return value
  }
}

describe('プロジェクトの完了（入力検証）', () => {
  it.each<[string, unknown[]]>([
    ['引数なし', []],
    ['UUIDでないID', [{ id: 'x', completed: true }]],
    ['completedなし（トグルにしない）', [{ id: MISSING_ID }]],
    ['completedが文字列', [{ id: MISSING_ID, completed: 'true' }]],
    ['余分なキー（日時の指定）', [{ id: MISSING_ID, completed: true, doneOn: '2026-01-01T00:00:00.000Z' }]]
  ])('不正な形（%s）を拒否する', (_label, args) => {
    expect(projectsSetCompletedArgsSchema.safeParse(args).success).toBe(false)
  })

  it('正しい形を受け付ける', () => {
    expect(projectsSetCompletedArgsSchema.safeParse([{ id: MISSING_ID, completed: false }]).success).toBe(true)
  })
})

describe('プロジェクトの完了ルール（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let dbFile: string
  let db: AppDatabase
  let tasks: TaskService
  let projects: ProjectService
  let n = 0

  beforeEach(() => {
    temp = createTempDir()
    dbFile = join(temp.dir, 'gtd.sqlite')
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    n = 0
    const now = createClock()
    const generateId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
    tasks = createTaskService({ ...taskServiceDeps(db), now, generateId })
    projects = createProjectService({ ...projectServiceDeps(db), now, generateId })
  })

  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  const row = (id: string) => createProjectRepository(db).findById(id)
  const taskRows = () => createTaskRepository(db).listAll()

  it('タスク0件のプロジェクトは完了できる。doneOn と updatedAt を同じ日時にし、createdAt・名前は変えない', () => {
    const project = projects.create({ name: '空' })
    const done = projects.setCompleted({ id: project.id, completed: true })
    expect(done).toMatchObject({ id: project.id, name: '空', createdAt: project.createdAt })
    expect(done.doneOn).not.toBeNull()
    expect(done.updatedAt).toBe(done.doneOn)
    expect(done.updatedAt > project.updatedAt).toBe(true)
    expect(row(project.id)).toEqual(done)
  })

  it('全タスクが完了済みなら完了できる。子タスクの状態・日時・所属は変えない', () => {
    const project = projects.create({ name: 'P' })
    const t1 = tasks.create({ title: 't1', ...inProject(db, project.id) })
    const t2 = tasks.create({ title: 't2', ...inProject(db, project.id) })
    tasks.setCompleted({ id: t1.id, completed: true })
    tasks.setCompleted({ id: t2.id, completed: true })
    const before = taskRows()
    projects.setCompleted({ id: project.id, completed: true })
    expect(taskRows()).toEqual(before)
    projects.setCompleted({ id: project.id, completed: false })
    expect(taskRows()).toEqual(before)
  })

  it('未完了タスクがあれば CONFLICT（型付きの件数つき）。プロジェクト・タスクは変えない', () => {
    const project = projects.create({ name: 'P' })
    tasks.create({ title: 'open1', ...inProject(db, project.id) })
    tasks.create({ title: 'open2', ...inProject(db, project.id) })
    const done = tasks.create({ title: 'done', ...inProject(db, project.id) })
    tasks.setCompleted({ id: done.id, completed: true })
    const before = taskRows()
    expect(() => projects.setCompleted({ id: project.id, completed: true })).toThrow(
      expect.objectContaining({
        code: 'CONFLICT',
        message: '未完了のタスクが2件あるため完了できません。',
        details: { kind: 'project-has-open-tasks', openTaskCount: 2 }
      })
    )
    expect(row(project.id)).toEqual(project)
    expect(taskRows()).toEqual(before)
  })

  it('件数は、そのプロジェクトに所属するタスクだけから数える（別プロジェクト・未所属は含めない）', () => {
    const p = projects.create({ name: 'P' })
    const other = projects.create({ name: 'Q' })
    tasks.create({ title: 'inbox-open' })
    tasks.create({ title: 'other-open', ...inProject(db, other.id) })
    const mine = tasks.create({ title: 'mine-open', ...inProject(db, p.id) })
    expect(() => projects.setCompleted({ id: p.id, completed: true })).toThrow(
      expect.objectContaining({ details: { kind: 'project-has-open-tasks', openTaskCount: 1 } })
    )
    tasks.setCompleted({ id: mine.id, completed: true })
    expect(projects.setCompleted({ id: p.id, completed: true }).doneOn).not.toBeNull()
  })

  it('外へ移したタスクは数えない（移動後に完了できる）', () => {
    const p = projects.create({ name: 'P' })
    const t = tasks.create({ title: 'open', ...inProject(db, p.id) })
    tasks.setAssignment({ id: t.id, projectId: null, milestoneId: null })
    expect(projects.setCompleted({ id: p.id, completed: true }).doneOn).not.toBeNull()
  })

  it('全タスクを完了しても、プロジェクトは自動では完了しない', () => {
    const p = projects.create({ name: 'P' })
    const t = tasks.create({ title: 't', ...inProject(db, p.id) })
    tasks.setCompleted({ id: t.id, completed: true })
    expect(row(p.id)?.doneOn).toBeNull()
  })

  it('完了の取り消し: doneOn を null にし updatedAt を更新する（createdAtは変えない）', () => {
    const p = projects.create({ name: 'P' })
    const done = projects.setCompleted({ id: p.id, completed: true })
    const reopened = projects.setCompleted({ id: p.id, completed: false })
    expect(reopened).toMatchObject({ doneOn: null, createdAt: p.createdAt, name: 'P' })
    expect(reopened.updatedAt > done.updatedAt).toBe(true)
  })

  it('既に目的の状態なら更新しない（日時を変えない）', () => {
    const p = projects.create({ name: 'P' })
    expect(projects.setCompleted({ id: p.id, completed: false })).toEqual(p)
    const done = projects.setCompleted({ id: p.id, completed: true })
    expect(projects.setCompleted({ id: p.id, completed: true })).toEqual(done)
    expect(row(p.id)).toEqual(done)
  })

  it('存在しないプロジェクトは NOT_FOUND', () => {
    expect(() => projects.setCompleted({ id: MISSING_ID, completed: true })).toThrow(/対象のプロジェクトが見つかりません/)
    expect(() => projects.setCompleted({ id: MISSING_ID, completed: false })).toThrow(/対象のプロジェクトが見つかりません/)
  })

  it('完了済みプロジェクトの操作ルール: 追加・移動・未完了へ戻すのは拒否、外への移動・タイトル編集・名前編集・取り消しは許可', () => {
    const p = projects.create({ name: 'P' })
    const q = projects.create({ name: 'Q' })
    const t1 = tasks.create({ title: 't1', ...inProject(db, p.id) })
    const t2 = tasks.create({ title: 't2', ...inProject(db, p.id) })
    const inbox = tasks.create({ title: 'inbox' })
    tasks.setCompleted({ id: t1.id, completed: true })
    tasks.setCompleted({ id: t2.id, completed: true })
    projects.setCompleted({ id: p.id, completed: true })

    expect(() => tasks.create({ title: 'new', ...inProject(db, p.id) })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(() => tasks.setAssignment({ id: inbox.id, ...inProject(db, p.id) })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    const beforeReopen = createTaskRepository(db).findById(t1.id)
    expect(() => tasks.setCompleted({ id: t1.id, completed: false })).toThrow(
      expect.objectContaining({
        code: 'CONFLICT',
        message: '完了済みのプロジェクトのタスクは未完了に戻せません。先にプロジェクトを未完了に戻してください。'
      })
    )
    expect(createTaskRepository(db).findById(t1.id)).toEqual(beforeReopen)
    // 既に完了のタスクへ completed: true の再要求は変更なしの成功
    expect({ ...tasks.setCompleted({ id: t1.id, completed: true }), hiddenAt: null }).toEqual(beforeReopen)

    expect(tasks.updateTitle({ id: t1.id, title: 't1（編集）' }).title).toBe('t1（編集）')
    expect(projects.rename({ id: p.id, name: 'P（編集）' })).toMatchObject({ name: 'P（編集）', doneOn: expect.any(String) })
    expect(tasks.setAssignment({ id: t2.id, ...inProject(db, q.id) }).projectId).toBe(q.id)

    // 外へ移したタスクは未完了に戻せる。プロジェクトを未完了に戻せば、所属タスクも未完了に戻せる
    expect(tasks.setCompleted({ id: t2.id, completed: false }).doneOn).toBeNull()
    expect(projects.setCompleted({ id: p.id, completed: false }).doneOn).toBeNull()
    expect(tasks.setCompleted({ id: t1.id, completed: false }).doneOn).toBeNull()
  })

  it('確認と更新は1つのトランザクション: 更新に失敗したら何も残らない', () => {
    const p = projects.create({ name: 'P' })
    const failing = createProjectService({
      ...projectServiceDeps(db),
      repository: {
        ...createProjectRepository(db),
        updateDone: () => {
          db.$client.prepare('UPDATE projects SET name = ? WHERE id = ?').run('途中の変更', p.id)
          throw new Error('書き込み失敗')
        }
      }
    })
    expect(() => failing.setCompleted({ id: p.id, completed: true })).toThrow('書き込み失敗')
    expect(row(p.id)).toEqual(p)
  })

  it('再接続後も完了状態が復元される', () => {
    const p = projects.create({ name: 'P' })
    const done = projects.setCompleted({ id: p.id, completed: true })
    closeDatabase(db)
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    expect(createProjectRepository(db).findById(p.id)).toEqual(done)
  })

  it('IPCハンドラー経由: CONFLICTは型付きの details を返し、SQLやスタックは返さない。NOT_FOUND・INVALID_INPUTも区別する', async () => {
    const policy: SenderPolicy = {
      getWindow: () => ({ isDestroyed: () => false, webContents: { id: 1 } }),
      isAllowedUrl: () => true
    }
    const event: InvokeEventLike = { sender: { id: 1 }, senderFrame: { url: 'file:///index.html', parent: null } }
    const logger = { warn: vi.fn(), error: vi.fn() }
    const handler = createIpcHandler({
      channel: 'projects:set-completed',
      argsSchema: projectsSetCompletedArgsSchema,
      policy,
      logger,
      run: ([input]) => projects.setCompleted(input)
    })
    const p = projects.create({ name: 'P' })
    tasks.create({ title: 'open', ...inProject(db, p.id) })
    expect(await handler(event, { id: p.id, completed: true })).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: '未完了のタスクが1件あるため完了できません。',
        details: { kind: 'project-has-open-tasks', openTaskCount: 1 }
      }
    })
    expect(await handler(event, { id: MISSING_ID, completed: true })).toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: '対象のプロジェクトが見つかりません。' }
    })
    expect(await handler(event, { id: p.id })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    const empty = projects.create({ name: '空' })
    expect(await handler(event, { id: empty.id, completed: true })).toMatchObject({ ok: true, data: { id: empty.id } })
    expect(logger.error).not.toHaveBeenCalled()
  })
})
