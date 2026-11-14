import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createIpcHandler, type InvokeEventLike, type SenderPolicy } from '../../src/main/ipc/handler'
import { createMilestoneRepository } from '../../src/main/repositories/milestone-repository'
import { createSettingsRepository } from '../../src/main/repositories/settings-repository'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createMilestoneService, type MilestoneService } from '../../src/main/services/milestone-service'
import { createProjectService, type ProjectService } from '../../src/main/services/project-service'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import { MILESTONE_NAME_MAX_LENGTH } from '../../src/shared/contracts/milestones'
import { PROJECT_NAME_MAX_LENGTH } from '../../src/shared/contracts/projects'
import { milestonesCreateArgsSchema, milestonesRenameArgsSchema } from '../../src/shared/validation/milestones'
import { tasksCreateArgsSchema, tasksSetAssignmentArgsSchema } from '../../src/shared/validation/tasks'
import {
  createTempDir,
  MIGRATIONS_DIR,
  milestoneServiceDeps,
  projectServiceDeps,
  taskServiceDeps
} from '../helpers/temp-database'

const MISSING_ID = '00000000-0000-4000-8000-00000000ffff'
const ANY_ID = '00000000-0000-4000-8000-000000000001'

function createClock(start = '2026-11-10T00:00:00.000Z') {
  let current = new Date(start).getTime()
  return () => {
    const value = new Date(current)
    current += 1000
    return value
  }
}

describe('マイルストン・所属の入力検証', () => {
  it('マイルストン名: 前後空白の除去、空白のみの拒否、上限（専用の定数）', () => {
    expect(milestonesCreateArgsSchema.parse([{ projectId: ANY_ID, name: '  M1  ' }])[0].name).toBe('M1')
    expect(milestonesCreateArgsSchema.safeParse([{ projectId: ANY_ID, name: ' \t ' }]).success).toBe(false)
    expect(MILESTONE_NAME_MAX_LENGTH).toBe(200)
    expect(MILESTONE_NAME_MAX_LENGTH).toBe(PROJECT_NAME_MAX_LENGTH) // 値は同じだが別の定数
    expect(milestonesCreateArgsSchema.safeParse([{ projectId: ANY_ID, name: 'a'.repeat(200) }]).success).toBe(true)
    expect(milestonesCreateArgsSchema.safeParse([{ projectId: ANY_ID, name: 'a'.repeat(201) }]).success).toBe(false)
    expect(milestonesRenameArgsSchema.safeParse([{ id: 'x', name: 'a' }]).success).toBe(false)
    expect(milestonesCreateArgsSchema.safeParse([{ projectId: ANY_ID, name: 'a', createdAt: 'x' }]).success).toBe(false)
  })

  it('マイルストンだけ・プロジェクトだけ（フェーズ5.6）の指定は入力の段階で拒否する', () => {
    expect(tasksSetAssignmentArgsSchema.safeParse([{ id: ANY_ID, projectId: null, milestoneId: ANY_ID }]).success).toBe(false)
    expect(tasksCreateArgsSchema.safeParse([{ title: 'a', milestoneId: ANY_ID }]).success).toBe(false)
    expect(tasksCreateArgsSchema.safeParse([{ title: 'a', projectId: null, milestoneId: ANY_ID }]).success).toBe(false)
    expect(tasksSetAssignmentArgsSchema.safeParse([{ id: ANY_ID, projectId: ANY_ID }]).success).toBe(false) // 省略は不可
    expect(tasksSetAssignmentArgsSchema.safeParse([{ id: ANY_ID, projectId: ANY_ID, milestoneId: null }]).success).toBe(false)
    expect(tasksCreateArgsSchema.safeParse([{ title: 'a', projectId: ANY_ID }]).success).toBe(false)
    expect(tasksSetAssignmentArgsSchema.safeParse([{ id: ANY_ID, projectId: ANY_ID, milestoneId: ANY_ID }]).success).toBe(true)
    expect(tasksSetAssignmentArgsSchema.safeParse([{ id: ANY_ID, projectId: null, milestoneId: null }]).success).toBe(true)
    expect(tasksCreateArgsSchema.safeParse([{ title: 'a' }]).success).toBe(true) // 従来の呼び出し（Inbox）
  })
})

describe('マイルストンと所属（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let dbFile: string
  let db: AppDatabase
  let tasks: TaskService
  let projects: ProjectService
  let milestones: MilestoneService
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
    milestones = createMilestoneService({ ...milestoneServiceDeps(db), now, generateId })
  })

  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  const row = (id: string) => createTaskRepository(db).findById(id)
  // プロジェクト作成時の初期マイルストン（フェーズ5.6）
  const initialOf = (projectId: string) => milestones.list().find((m) => m.projectId === projectId)!

  it('マイルストンの登録・一覧（作成日時・IDの昇順）・同名の許可', () => {
    const p = projects.create({ name: 'P' })
    const initial = initialOf(p.id)
    const m1 = milestones.create({ projectId: p.id, name: 'M' })
    const m2 = milestones.create({ projectId: p.id, name: 'M' })
    expect(m1).toMatchObject({ projectId: p.id, name: 'M' })
    expect(m1.createdAt).toBe(m1.updatedAt)
    expect(milestones.list().map((m) => m.id)).toEqual([initial.id, m1.id, m2.id])
  })

  it('同じ作成日時ならIDの昇順', () => {
    const p = projects.create({ name: 'P' })
    const fixed = createMilestoneService({
      ...milestoneServiceDeps(db),
      now: () => new Date('2026-11-10T05:00:00.000Z'),
      generateId: (() => {
        const ids = ['00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-0000000000aa']
        return () => ids.shift() ?? MISSING_ID
      })()
    })
    fixed.create({ projectId: p.id, name: 'b' })
    fixed.create({ projectId: p.id, name: 'a' })
    expect(milestones.list().map((m) => m.id)).toEqual([
      initialOf(p.id).id,
      '00000000-0000-4000-8000-0000000000aa',
      '00000000-0000-4000-8000-0000000000bb'
    ])
  })

  it('名前変更: updatedAtだけ更新、同じ名前なら更新しない、存在しないIDは NOT_FOUND', () => {
    const p = projects.create({ name: 'P' })
    const m = milestones.create({ projectId: p.id, name: '旧' })
    const renamed = milestones.rename({ id: m.id, name: '新' })
    expect(renamed).toMatchObject({ id: m.id, projectId: p.id, name: '新', createdAt: m.createdAt })
    expect(renamed.updatedAt > m.updatedAt).toBe(true)
    expect(milestones.rename({ id: m.id, name: '新' })).toEqual(renamed)
    expect(() => milestones.rename({ id: MISSING_ID, name: 'x' })).toThrow(/対象のマイルストンが見つかりません/)
  })

  it('登録: 存在しないプロジェクトは NOT_FOUND、完了済みプロジェクトは CONFLICT。既存マイルストンの名前変更は可能', () => {
    expect(() => milestones.create({ projectId: MISSING_ID, name: 'M' })).toThrow(/指定したプロジェクトが見つかりません/)
    const p = projects.create({ name: 'P' })
    const m = milestones.create({ projectId: p.id, name: 'M' })
    projects.setCompleted({ id: p.id, completed: true })
    expect(() => milestones.create({ projectId: p.id, name: 'M2' })).toThrow(
      expect.objectContaining({ code: 'CONFLICT', message: '完了済みのプロジェクトにはマイルストンを追加できません。' })
    )
    expect(milestones.rename({ id: m.id, name: '完了後の改名' }).name).toBe('完了後の改名')
  })

  it('作成: マイルストンつきで作成できる。プロジェクトだけ・他プロジェクトのマイルストン・存在しないマイルストンは拒否（フェーズ5.6）', () => {
    const p = projects.create({ name: 'P' })
    const q = projects.create({ name: 'Q' })
    const mp = milestones.create({ projectId: p.id, name: 'MP' })
    const mq = milestones.create({ projectId: q.id, name: 'MQ' })
    expect(() => tasks.create({ title: 'a', projectId: p.id })).toThrow(
      expect.objectContaining({ code: 'CONFLICT', message: 'プロジェクトに所属させる場合は、そのプロジェクトのマイルストンも指定してください。' })
    )
    expect(tasks.create({ title: 'b', projectId: p.id, milestoneId: mp.id })).toMatchObject({ projectId: p.id, milestoneId: mp.id })
    const before = tasks.list().length
    expect(() => tasks.create({ title: 'c', projectId: p.id, milestoneId: mq.id })).toThrow(
      expect.objectContaining({ code: 'CONFLICT', message: '指定したマイルストンは、そのプロジェクトに属していません。' })
    )
    expect(() => tasks.create({ title: 'd', projectId: p.id, milestoneId: MISSING_ID })).toThrow(/指定したマイルストンが見つかりません/)
    expect(tasks.list()).toHaveLength(before)
  })

  it('所属変更: Inbox → マイルストン → 同じプロジェクトの別マイルストン → 別プロジェクト（旧マイルストンを残さない）→ Inbox。ID・作成日時・完了日時は変えない', () => {
    const p = projects.create({ name: 'P' })
    const q = projects.create({ name: 'Q' })
    const m = milestones.create({ projectId: p.id, name: 'M' })
    const created = tasks.create({ title: 't' })
    const done = tasks.setCompleted({ id: created.id, completed: true })

    const toP = tasks.setAssignment({ id: created.id, projectId: p.id, milestoneId: initialOf(p.id).id })
    expect(toP).toMatchObject({ id: created.id, projectId: p.id, milestoneId: initialOf(p.id).id, createdAt: created.createdAt, doneOn: done.doneOn })
    expect(toP.updatedAt > done.updatedAt).toBe(true)
    const toM = tasks.setAssignment({ id: created.id, projectId: p.id, milestoneId: m.id })
    expect(toM).toMatchObject({ projectId: p.id, milestoneId: m.id })
    expect(toM.updatedAt > toP.updatedAt).toBe(true)
    const toQ = tasks.setAssignment({ id: created.id, projectId: q.id, milestoneId: initialOf(q.id).id })
    expect(toQ).toMatchObject({ projectId: q.id, milestoneId: initialOf(q.id).id })
    const inbox = tasks.setAssignment({ id: created.id, projectId: null, milestoneId: null })
    expect(inbox).toMatchObject({ projectId: null, milestoneId: null, title: 't', createdAt: created.createdAt, doneOn: done.doneOn })
  })

  it('同じ所属（プロジェクト・マイルストンの両方）への再要求は変更なしの成功', () => {
    const p = projects.create({ name: 'P' })
    const m = milestones.create({ projectId: p.id, name: 'M' })
    const t = tasks.create({ title: 't', projectId: p.id, milestoneId: m.id })
    expect(tasks.setAssignment({ id: t.id, projectId: p.id, milestoneId: m.id })).toEqual(t)
    // マイルストンだけ外す（プロジェクトだけの所属にする）ことはできない（フェーズ5.6）。何も変えない
    expect(() => tasks.setAssignment({ id: t.id, projectId: p.id, milestoneId: null })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(row(t.id)).toMatchObject({ projectId: p.id, milestoneId: m.id, updatedAt: t.updatedAt })
  })

  it('所属変更の拒否: 存在しない・他プロジェクトのマイルストン・完了済みプロジェクト。拒否時は何も変えない', () => {
    const p = projects.create({ name: 'P' })
    const q = projects.create({ name: 'Q' })
    const mq = milestones.create({ projectId: q.id, name: 'MQ' })
    const t = tasks.create({ title: 't' })
    expect(() => tasks.setAssignment({ id: MISSING_ID, projectId: null, milestoneId: null })).toThrow(/対象のタスクが見つかりません/)
    expect(() => tasks.setAssignment({ id: t.id, projectId: MISSING_ID, milestoneId: mq.id })).toThrow(/指定したプロジェクトが見つかりません/)
    expect(() => tasks.setAssignment({ id: t.id, projectId: p.id, milestoneId: MISSING_ID })).toThrow(/指定したマイルストンが見つかりません/)
    expect(() => tasks.setAssignment({ id: t.id, projectId: p.id, milestoneId: mq.id })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(() => tasks.setAssignment({ id: t.id, projectId: null, milestoneId: mq.id })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    const mp = milestones.create({ projectId: p.id, name: 'MP' })
    projects.setCompleted({ id: p.id, completed: true })
    expect(() => tasks.setAssignment({ id: t.id, projectId: p.id, milestoneId: mp.id })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(row(t.id)).toMatchObject({ projectId: null, milestoneId: null, updatedAt: t.updatedAt })
  })

  it('完了済みプロジェクト: 同じ所属の再要求は成功、外への移動は許可、内部のマイルストン変更は拒否', () => {
    const p = projects.create({ name: 'P' })
    const q = projects.create({ name: 'Q' })
    const m1 = milestones.create({ projectId: p.id, name: 'M1' })
    const m2 = milestones.create({ projectId: p.id, name: 'M2' })
    const created = tasks.create({ title: 't', projectId: p.id, milestoneId: m1.id })
    const other = tasks.create({ title: 'u', projectId: p.id, milestoneId: m1.id })
    tasks.setCompleted({ id: created.id, completed: true })
    tasks.setCompleted({ id: other.id, completed: true })
    projects.setCompleted({ id: p.id, completed: true })
    const t = row(created.id)!
    expect(tasks.setAssignment({ id: t.id, projectId: p.id, milestoneId: m1.id })).toMatchObject({ updatedAt: t.updatedAt })
    expect(() => tasks.setAssignment({ id: t.id, projectId: p.id, milestoneId: m2.id })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(tasks.setAssignment({ id: t.id, projectId: q.id, milestoneId: initialOf(q.id).id })).toMatchObject({ projectId: q.id, milestoneId: initialOf(q.id).id })
    expect(tasks.setAssignment({ id: other.id, projectId: null, milestoneId: null })).toMatchObject({ projectId: null, milestoneId: null })
  })

  it('既存の完了制約: マイルストン内の未完了タスクもプロジェクトの完了判定に数える', () => {
    const p = projects.create({ name: 'P' })
    const m = milestones.create({ projectId: p.id, name: 'M' })
    tasks.create({ title: 't', projectId: p.id, milestoneId: m.id })
    expect(() => projects.setCompleted({ id: p.id, completed: true })).toThrow(
      expect.objectContaining({ details: { kind: 'project-has-open-tasks', openTaskCount: 1 } })
    )
  })

  it('外部キー: 存在しないマイルストンIDはDBでも保存できない', () => {
    const p = projects.create({ name: 'P' })
    const t = tasks.create({ title: 't', projectId: p.id, milestoneId: initialOf(p.id).id })
    expect(() => createTaskRepository(db).updateAssignment(t.id, p.id, MISSING_ID, null, '2026-11-10T10:00:00.000Z')).toThrow(/FOREIGN KEY/)
    expect(() =>
      createMilestoneRepository(db).insert({ favorite: false,
      id: ANY_ID, projectId: MISSING_ID, name: 'x', createdAt: 'a', updatedAt: 'a', done: false, doneOn: null, position: null })
    ).toThrow(/FOREIGN KEY/)
  })

  it('再接続後もマイルストンと所属が復元される', () => {
    const p = projects.create({ name: 'P' })
    const m = milestones.create({ projectId: p.id, name: 'M' })
    const t = tasks.create({ title: 't', projectId: p.id, milestoneId: m.id })
    const initial = initialOf(p.id)
    closeDatabase(db)
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    expect(createMilestoneRepository(db).listAll().filter((r) => r.projectId === p.id)).toEqual([initial, m])
    expect(createTaskRepository(db).findById(t.id)).toMatchObject({ projectId: p.id, milestoneId: m.id })
  })

  it('IPCハンドラー経由: 不正入力・NOT_FOUND・CONFLICT を区別する', async () => {
    const policy: SenderPolicy = {
      getWindow: () => ({ isDestroyed: () => false, webContents: { id: 1 } }),
      isAllowedUrl: () => true
    }
    const event: InvokeEventLike = { sender: { id: 1 }, senderFrame: { url: 'file:///index.html', parent: null } }
    const logger = { warn: vi.fn(), error: vi.fn() }
    const assign = createIpcHandler({ channel: 'tasks:set-assignment', argsSchema: tasksSetAssignmentArgsSchema, policy, logger, run: ([i]) => tasks.setAssignment(i) })
    const createMilestone = createIpcHandler({ channel: 'milestones:create', argsSchema: milestonesCreateArgsSchema, policy, logger, run: ([i]) => milestones.create(i) })
    const p = projects.create({ name: 'P' })
    const q = projects.create({ name: 'Q' })
    const mq = milestones.create({ projectId: q.id, name: 'MQ' })
    const t = tasks.create({ title: 't' })
    expect(await assign(event, { id: t.id, projectId: null, milestoneId: mq.id })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await assign(event, { id: t.id, projectId: p.id, milestoneId: mq.id })).toMatchObject({ ok: false, error: { code: 'CONFLICT' } })
    expect(await assign(event, { id: t.id, projectId: p.id, milestoneId: MISSING_ID })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await assign(event, { id: t.id, projectId: q.id, milestoneId: mq.id })).toMatchObject({ ok: true, data: { projectId: q.id, milestoneId: mq.id } })
    expect(await createMilestone(event, { projectId: MISSING_ID, name: 'x' })).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } })
    expect(await createMilestone(event, { projectId: p.id, name: '  ' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(logger.error).not.toHaveBeenCalled()
  })
})

// 0005 まで適用した時点の確認（0006 ではプロジェクトだけに所属するタスクを削除するため、ここでは 0005 で止める。0006 は deletion.test.ts）
describe('移行（0004 → 0005）', () => {
  let temp: ReturnType<typeof createTempDir>
  beforeEach(() => {
    temp = createTempDir()
  })
  afterEach(() => temp.cleanup())

  it('既存のタスク（所属・状態・日時）・プロジェクト・Workspace設定を保持し、milestone_id はNULL。再実行で何も適用しない', () => {
    const dbFile = join(temp.dir, 'gtd.sqlite')
    const oldDir = join(temp.dir, 'migrations-phase53')
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    const entries = journal.entries.slice(0, 5)
    mkdirSync(join(oldDir, 'meta'), { recursive: true })
    writeFileSync(join(oldDir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
    for (const entry of entries) copyFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(oldDir, `${entry.tag}.sql`))

    const old = openDatabase(dbFile)
    expect(runMigrations(old, oldDir)).toEqual({ appliedBefore: 0, appliedAfter: 5 })
    const pid = '33333333-3333-4333-8333-333333333333'
    old.$client.prepare('INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?)').run(pid, 'P', 'a', 'a', null)
    const insert = old.$client.prepare('INSERT INTO tasks (id, title, created_at, updated_at, completed_at, project_id) VALUES (?, ?, ?, ?, ?, ?)')
    insert.run('11111111-1111-4111-8111-111111111111', '所属あり', '2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z', pid)
    insert.run('22222222-2222-4222-8222-222222222222', '未所属', '2026-11-03T00:00:00.000Z', '2026-11-03T00:00:00.000Z', null, null)
    const workspace = JSON.stringify({ version: 1, sidebarWidth: 300, detailWidth: 320, detailVisible: false, lastRoute: `/projects/${pid}` })
    createSettingsRepository(old).upsert({ key: 'workspace', value: workspace, updatedAt: 'w' })
    const beforeTasks = old.$client.prepare('SELECT * FROM tasks ORDER BY id').all() as Record<string, unknown>[]
    const beforeProjects = old.$client.prepare('SELECT * FROM projects').all()
    closeDatabase(old)

    const upTo0005 = join(temp.dir, 'migrations-phase54')
    mkdirSync(join(upTo0005, 'meta'), { recursive: true })
    const entries54 = journal.entries.slice(0, 6)
    writeFileSync(join(upTo0005, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: entries54 }))
    for (const entry of entries54) copyFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(upTo0005, `${entry.tag}.sql`))
    const upgraded = openDatabase(dbFile)
    expect(runMigrations(upgraded, upTo0005)).toEqual({ appliedBefore: 5, appliedAfter: 6 })
    expect(upgraded.$client.prepare('SELECT * FROM tasks ORDER BY id').all()).toEqual(beforeTasks.map((t) => ({ ...t, milestone_id: null })))
    expect(upgraded.$client.prepare('SELECT * FROM projects').all()).toEqual(beforeProjects)
    expect(createSettingsRepository(upgraded).get('workspace')?.value).toBe(workspace)
    expect(upgraded.$client.prepare('SELECT COUNT(*) AS c FROM milestones').get()).toEqual({ c: 0 })
    expect(upgraded.$client.prepare('PRAGMA foreign_key_list(tasks)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'milestones', from: 'milestone_id', to: 'id' })])
    )
    expect(upgraded.$client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    closeDatabase(upgraded)

    const restarted = openDatabase(dbFile)
    expect(runMigrations(restarted, upTo0005)).toEqual({ appliedBefore: 6, appliedAfter: 6 })
    closeDatabase(restarted)
  })
})
