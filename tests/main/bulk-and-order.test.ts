// フェーズ5.9: Inboxからの一括紐付け・一括削除・タスクとマイルストンの手動順（一時DB）。
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createIpcHandler, type InvokeEventLike, type SenderPolicy } from '../../src/main/ipc/handler'
import { createMilestoneService, type MilestoneService } from '../../src/main/services/milestone-service'
import { createProjectService, type ProjectService } from '../../src/main/services/project-service'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import { milestonesReorderArgsSchema } from '../../src/shared/validation/milestones'
import {
  tasksAssignFromInboxArgsSchema,
  tasksDeleteManyArgsSchema,
  tasksReorderInMilestoneArgsSchema
} from '../../src/shared/validation/tasks'
import { TASK_BULK_MAX } from '../../src/shared/contracts/tasks'
import { createTempDir, MIGRATIONS_DIR, milestoneServiceDeps, projectServiceDeps, taskServiceDeps } from '../helpers/temp-database'

const MISSING_ID = '00000000-0000-4000-8000-00000000ffff'

function createClock(start = '2026-11-11T00:00:00.000Z') {
  let current = new Date(start).getTime()
  return () => {
    const value = new Date(current)
    current += 1000
    return value
  }
}

describe('一括紐付け・一括削除・手動順（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let db: AppDatabase
  let tasks: TaskService
  let projects: ProjectService
  let milestones: MilestoneService
  let n = 0

  beforeEach(() => {
    temp = createTempDir()
    db = openDatabase(join(temp.dir, 'gtd.sqlite'))
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

  const raw = () => db.$client.prepare('SELECT * FROM tasks ORDER BY id').all()
  const rawMilestones = () => db.$client.prepare('SELECT * FROM milestones ORDER BY id').all()
  const firstMilestone = (projectId: string) => milestones.list().find((m) => m.projectId === projectId)!
  const inMilestone = (milestoneId: string) =>
    tasks
      .list()
      .filter((t) => t.milestoneId === milestoneId)
      .sort((a, b) => ((a.position ?? Infinity) - (b.position ?? Infinity)) || (a.createdAt < b.createdAt ? -1 : 1))

  describe('Inboxからの一括紐付け（assignFromInbox）', () => {
    it('全件を1回で移し、指定順に返す。手動順のないマイルストンでは position は null のまま', () => {
      const p = projects.create({ name: 'P' })
      const m = firstMilestone(p.id)
      const [a, b, c] = ['a', 'b', 'c'].map((title) => tasks.create({ title }))
      const result = tasks.assignFromInbox({ ids: [c!.id, a!.id], projectId: p.id, milestoneId: m.id })
      expect(result.map((t) => t.id)).toEqual([c!.id, a!.id])
      expect(result.every((t) => t.projectId === p.id && t.milestoneId === m.id && t.position === null)).toBe(true)
      // タイトル・完了状態・作成日時は変えない
      expect(result[0]).toMatchObject({ title: 'c', createdAt: c!.createdAt, doneOn: null })
      expect(tasks.list().find((t) => t.id === b!.id)).toMatchObject({ projectId: null, milestoneId: null })
    })

    it('手動順のあるマイルストンには、指定順で末尾へ追加する', () => {
      const p = projects.create({ name: 'P' })
      const m = firstMilestone(p.id)
      const x = tasks.create({ title: 'x', projectId: p.id, milestoneId: m.id })
      const y = tasks.create({ title: 'y', projectId: p.id, milestoneId: m.id })
      tasks.reorderInMilestone({ milestoneId: m.id, orderedIds: [y.id, x.id] })
      const a = tasks.create({ title: 'a' })
      const b = tasks.create({ title: 'b' })
      tasks.assignFromInbox({ ids: [b.id, a.id], projectId: p.id, milestoneId: m.id })
      expect(inMilestone(m.id).map((t) => [t.title, t.position])).toEqual([
        ['y', 0],
        ['x', 1],
        ['b', 2],
        ['a', 3]
      ])
    })

    it('1件でも存在しない・非表示・Inbox以外なら、何も変更しない（全体ロールバック）', () => {
      const p = projects.create({ name: 'P' })
      const m = firstMilestone(p.id)
      const other = milestones.create({ projectId: p.id, name: 'M2' })
      const a = tasks.create({ title: 'a' })
      const inProject = tasks.create({ title: 'in', projectId: p.id, milestoneId: other.id })
      const hidden = tasks.create({ title: 'h', projectId: p.id, milestoneId: other.id })
      const before = raw()
      expect(() => tasks.assignFromInbox({ ids: [a.id, MISSING_ID], projectId: p.id, milestoneId: m.id })).toThrow(/一部が見つかりません/)
      expect(() => tasks.assignFromInbox({ ids: [a.id, inProject.id], projectId: p.id, milestoneId: m.id })).toThrow(/既にInboxにありません/)
      expect(raw()).toEqual(before)
      // マイルストンの削除で非表示になったタスクは対象にしない
      milestones.delete({ id: other.id, expectedTaskCount: 2 })
      const beforeHidden = raw()
      expect(() => tasks.assignFromInbox({ ids: [a.id, hidden.id], projectId: p.id, milestoneId: m.id })).toThrow(/一部が見つかりません/)
      expect(raw()).toEqual(beforeHidden)
    })

    it('移動先の検証: 完了済みプロジェクト・別プロジェクトのマイルストン・削除済みマイルストンは拒否し、何も変更しない', () => {
      const p = projects.create({ name: 'P' })
      const q = projects.create({ name: 'Q' })
      const mp = firstMilestone(p.id)
      const mq = firstMilestone(q.id)
      const a = tasks.create({ title: 'a' })
      const b = tasks.create({ title: 'b' })
      const before = raw()
      expect(() => tasks.assignFromInbox({ ids: [a.id, b.id], projectId: p.id, milestoneId: mq.id })).toThrow(/そのプロジェクトに属していません/)
      expect(() => tasks.assignFromInbox({ ids: [a.id], projectId: MISSING_ID, milestoneId: mp.id })).toThrow(/指定したプロジェクトが見つかりません/)
      // ドラッグ開始後に移動先が削除された場合（Mainで再検証する）
      const removed = milestones.create({ projectId: p.id, name: 'tmp' })
      milestones.delete({ id: removed.id, expectedTaskCount: 0 })
      expect(() => tasks.assignFromInbox({ ids: [a.id], projectId: p.id, milestoneId: removed.id })).toThrow(/指定したマイルストンが見つかりません/)
      // ドラッグ開始後に移動先が完了された場合
      projects.setCompleted({ id: q.id, completed: true })
      expect(() => tasks.assignFromInbox({ ids: [a.id, b.id], projectId: q.id, milestoneId: mq.id })).toThrow(/完了済みのプロジェクト/)
      const afterAll = raw()
      expect(afterAll).toEqual(before)
    })

    it('2回目（二重送信）は、既にInboxにないため CONFLICT で何も変えない', () => {
      const p = projects.create({ name: 'P' })
      const m = firstMilestone(p.id)
      const a = tasks.create({ title: 'a' })
      tasks.assignFromInbox({ ids: [a.id], projectId: p.id, milestoneId: m.id })
      const before = raw()
      expect(() => tasks.assignFromInbox({ ids: [a.id], projectId: p.id, milestoneId: m.id })).toThrow(/既にInboxにありません/)
      expect(raw()).toEqual(before)
    })
  })

  describe('一括削除（deleteMany）', () => {
    it('全件を物理削除する。他のタスクは変えない', () => {
      const [a, b, c] = ['a', 'b', 'c'].map((title) => tasks.create({ title }))
      expect(tasks.deleteMany({ ids: [a!.id, c!.id] })).toEqual({ ids: [a!.id, c!.id] })
      expect(tasks.list().map((t) => t.id)).toEqual([b!.id])
    })
    it('1件でも存在しない・非表示なら、何も削除しない', () => {
      const p = projects.create({ name: 'P' })
      const m = milestones.create({ projectId: p.id, name: 'M' })
      const a = tasks.create({ title: 'a' })
      const h = tasks.create({ title: 'h', projectId: p.id, milestoneId: m.id })
      milestones.delete({ id: m.id, expectedTaskCount: 1 })
      const before = raw()
      expect(() => tasks.deleteMany({ ids: [a.id, MISSING_ID] })).toThrow(/一部が見つかりません/)
      expect(() => tasks.deleteMany({ ids: [a.id, h.id] })).toThrow(/一部が見つかりません/)
      expect(raw()).toEqual(before)
      // 二重実行の2回目は NOT_FOUND
      tasks.deleteMany({ ids: [a.id] })
      expect(() => tasks.deleteMany({ ids: [a.id] })).toThrow(/一部が見つかりません/)
    })
  })

  describe('タスクの手動順（reorderInMilestone）', () => {
    it('初期順は作成日時の古い順。並べ替えは順位だけを保存し、作成・更新・完了日時は変えない', () => {
      const p = projects.create({ name: 'P' })
      const m = firstMilestone(p.id)
      const [a, b, c] = ['a', 'b', 'c'].map((title) => tasks.create({ title, projectId: p.id, milestoneId: m.id }))
      tasks.setCompleted({ id: b!.id, completed: true })
      expect(inMilestone(m.id).map((t) => t.title)).toEqual(['a', 'b', 'c'])
      const before = tasks.list()
      const result = tasks.reorderInMilestone({ milestoneId: m.id, orderedIds: [c!.id, a!.id, b!.id] })
      expect(result.map((t) => [t.title, t.position])).toEqual([
        ['c', 0],
        ['a', 1],
        ['b', 2]
      ])
      for (const task of result) {
        const old = before.find((t) => t.id === task.id)!
        expect(task).toEqual({ ...old, position: task.position })
      }
    })

    it('一部だけ・別のタスクを含む・存在しない指定は CONFLICT（order-changed）で何も変えない', () => {
      const p = projects.create({ name: 'P' })
      const m = firstMilestone(p.id)
      const other = milestones.create({ projectId: p.id, name: 'M2' })
      const [a, b] = ['a', 'b'].map((title) => tasks.create({ title, projectId: p.id, milestoneId: m.id }))
      const elsewhere = tasks.create({ title: 'e', projectId: p.id, milestoneId: other.id })
      const before = raw()
      expect(() => tasks.reorderInMilestone({ milestoneId: m.id, orderedIds: [b!.id] })).toThrow(/並べ替えを保存しませんでした/)
      expect(() => tasks.reorderInMilestone({ milestoneId: m.id, orderedIds: [b!.id, elsewhere.id] })).toThrow(/並べ替えを保存しませんでした/)
      expect(() => tasks.reorderInMilestone({ milestoneId: m.id, orderedIds: [b!.id, a!.id, MISSING_ID] })).toThrow(/並べ替えを保存しませんでした/)
      expect(() => tasks.reorderInMilestone({ milestoneId: MISSING_ID, orderedIds: [a!.id] })).toThrow(/指定したマイルストンが見つかりません/)
      expect(raw()).toEqual(before)
    })

    it('手動順があれば新規・移動したタスクは末尾。手動順がなければ null（作成日時の順）。Inboxへ戻すと null', () => {
      const p = projects.create({ name: 'P' })
      const m = firstMilestone(p.id)
      const plain = milestones.create({ projectId: p.id, name: 'plain' })
      const [a, b] = ['a', 'b'].map((title) => tasks.create({ title, projectId: p.id, milestoneId: m.id }))
      tasks.reorderInMilestone({ milestoneId: m.id, orderedIds: [b!.id, a!.id] })
      const created = tasks.create({ title: 'new', projectId: p.id, milestoneId: m.id })
      expect(created.position).toBe(2)
      const moved = tasks.create({ title: 'moved', projectId: p.id, milestoneId: plain.id })
      expect(moved.position).toBeNull()
      expect(tasks.setAssignment({ id: moved.id, projectId: p.id, milestoneId: m.id }).position).toBe(3)
      expect(inMilestone(m.id).map((t) => t.title)).toEqual(['b', 'a', 'new', 'moved'])
      // 手動順のないマイルストンへ移すと null
      expect(tasks.setAssignment({ id: a!.id, projectId: p.id, milestoneId: plain.id }).position).toBeNull()
      // Inboxへ戻すと null
      expect(tasks.setAssignment({ id: b!.id, projectId: null, milestoneId: null }).position).toBeNull()
    })
  })

  describe('カードの手動順（milestones.reorder）', () => {
    it('初期順は作成日時の古い順。並べ替え後は保存した順で返し、新しいマイルストンは末尾。名前・日時は変えない', () => {
      const p = projects.create({ name: 'P' })
      const m1 = firstMilestone(p.id)
      const m2 = milestones.create({ projectId: p.id, name: 'M2' })
      const m3 = milestones.create({ projectId: p.id, name: 'M3' })
      expect(milestones.list().map((m) => m.id)).toEqual([m1.id, m2.id, m3.id])
      expect(m2.position).toBeNull()
      const result = milestones.reorder({ projectId: p.id, orderedIds: [m3.id, m1.id, m2.id] })
      expect(result.map((m) => [m.name, m.position])).toEqual([
        ['M3', 0],
        [m1.name, 1],
        ['M2', 2]
      ])
      expect(result.find((m) => m.id === m2.id)).toEqual({ ...m2, position: 2 })
      const m4 = milestones.create({ projectId: p.id, name: 'M4' })
      expect(m4.position).toBe(3)
      expect(milestones.list().map((m) => m.name)).toEqual(['M3', m1.name, 'M2', 'M4'])
    })

    it('同名でもIDで区別する。一部・他プロジェクトのIDを含む指定は CONFLICT で何も変えない', () => {
      const p = projects.create({ name: 'P' })
      const q = projects.create({ name: 'Q' })
      const m1 = firstMilestone(p.id)
      const same = milestones.create({ projectId: p.id, name: m1.name })
      const before = rawMilestones()
      expect(() => milestones.reorder({ projectId: p.id, orderedIds: [same.id] })).toThrow(/並べ替えを保存しませんでした/)
      expect(() => milestones.reorder({ projectId: p.id, orderedIds: [same.id, firstMilestone(q.id).id] })).toThrow(
        /並べ替えを保存しませんでした/
      )
      expect(() => milestones.reorder({ projectId: MISSING_ID, orderedIds: [same.id] })).toThrow(/指定したプロジェクトが見つかりません/)
      expect(rawMilestones()).toEqual(before)
      expect(milestones.reorder({ projectId: p.id, orderedIds: [same.id, m1.id] }).map((m) => m.id)).toEqual([same.id, m1.id])
    })

    it('削除済みのマイルストンは並べ替えの対象に含めない（含めると CONFLICT）', () => {
      const p = projects.create({ name: 'P' })
      const m1 = firstMilestone(p.id)
      const m2 = milestones.create({ projectId: p.id, name: 'M2' })
      milestones.delete({ id: m2.id, expectedTaskCount: 0 })
      expect(() => milestones.reorder({ projectId: p.id, orderedIds: [m1.id, m2.id] })).toThrow(/並べ替えを保存しませんでした/)
      expect(milestones.reorder({ projectId: p.id, orderedIds: [m1.id] }).map((m) => m.id)).toEqual([m1.id])
    })
  })
})

describe('一括・並べ替えの入力検証（IPC）', () => {
  const policy: SenderPolicy = { getWindow: () => ({ isDestroyed: () => false, webContents: { id: 1 } }), isAllowedUrl: () => true }
  const event: InvokeEventLike = { sender: { id: 1 }, senderFrame: { url: 'app://index.html', parent: null } }
  const logger = { warn: () => {}, error: () => {} }
  const A = '00000000-0000-4000-8000-000000000001'
  const B = '00000000-0000-4000-8000-000000000002'

  it.each<[string, unknown]>([
    ['IDの重複', { ids: [A, A], projectId: B, milestoneId: B }],
    ['空の一覧', { ids: [], projectId: B, milestoneId: B }],
    ['IDの形式', { ids: ['x'], projectId: B, milestoneId: B }],
    ['移動先がInbox（null）', { ids: [A], projectId: null, milestoneId: null }],
    ['余分なキー', { ids: [A], projectId: B, milestoneId: B, title: 'x' }],
    ['上限超過', { ids: Array.from({ length: TASK_BULK_MAX + 1 }, () => A), projectId: B, milestoneId: B }]
  ])('一括紐付け: %s は INVALID_INPUT（Serviceを呼ばない）', async (_label, input) => {
    let called = false
    const handler = createIpcHandler({
      channel: 'tasks:assign-from-inbox',
      argsSchema: tasksAssignFromInboxArgsSchema,
      policy,
      logger,
      run: () => {
        called = true
        return []
      }
    })
    expect(await handler(event, input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(called).toBe(false)
  })

  it('一括削除・タスクの並べ替え・カードの並べ替え: 重複IDは拒否する', () => {
    expect(tasksDeleteManyArgsSchema.safeParse([{ ids: [A, A] }]).success).toBe(false)
    expect(tasksDeleteManyArgsSchema.safeParse([{ ids: [A, B] }]).success).toBe(true)
    expect(tasksReorderInMilestoneArgsSchema.safeParse([{ milestoneId: B, orderedIds: [A, A] }]).success).toBe(false)
    expect(tasksReorderInMilestoneArgsSchema.safeParse([{ milestoneId: B, orderedIds: [A] }]).success).toBe(true)
    expect(milestonesReorderArgsSchema.safeParse([{ projectId: B, orderedIds: [A, A] }]).success).toBe(false)
    expect(milestonesReorderArgsSchema.safeParse([{ projectId: B, orderedIds: [A] }]).success).toBe(true)
  })
})
