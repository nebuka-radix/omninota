// フェーズ5.6: タスク・マイルストン・プロジェクトの削除、削除由来の非表示状態、所属ルールの変更、0006 の移行（一時DB）。
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createIpcHandler, type InvokeEventLike, type SenderPolicy } from '../../src/main/ipc/handler'
import { createMilestoneRepository } from '../../src/main/repositories/milestone-repository'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createMilestoneService, type MilestoneService } from '../../src/main/services/milestone-service'
import { createProjectService, type ProjectService } from '../../src/main/services/project-service'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import { INITIAL_MILESTONE_NAME } from '../../src/shared/contracts/milestones'
import { milestonesDeleteArgsSchema } from '../../src/shared/validation/milestones'
import { projectsDeleteArgsSchema } from '../../src/shared/validation/projects'
import { tasksDeleteArgsSchema } from '../../src/shared/validation/tasks'
import {
  createTempDir,
  MIGRATION_COUNT,
  MIGRATIONS_DIR,
  milestoneServiceDeps,
  projectServiceDeps,
  taskServiceDeps
} from '../helpers/temp-database'

const MISSING_ID = '00000000-0000-4000-8000-00000000ffff'

function createClock(start = '2026-11-10T00:00:00.000Z') {
  let current = new Date(start).getTime()
  return () => {
    const value = new Date(current)
    current += 1000
    return value
  }
}

type RawTask = {
  id: string
  title: string
  created_at: string
  updated_at: string
  done_on: string | null
  project_id: string | null
  milestone_id: string | null
  hidden_at: string | null
}
type RawMilestone = { id: string; project_id: string | null; name: string; created_at: string; updated_at: string }

describe('削除・非表示（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let dbFile: string
  let db: AppDatabase
  let tasks: TaskService
  let projects: ProjectService
  let milestones: MilestoneService
  let n = 0
  let now: () => Date

  const build = () => {
    const generateId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
    tasks = createTaskService({ ...taskServiceDeps(db), now, generateId })
    projects = createProjectService({ ...projectServiceDeps(db), now, generateId })
    milestones = createMilestoneService({ ...milestoneServiceDeps(db), now, generateId })
  }

  beforeEach(() => {
    temp = createTempDir()
    dbFile = join(temp.dir, 'gtd.sqlite')
    db = openDatabase(dbFile)
    runMigrations(db, MIGRATIONS_DIR)
    n = 0
    now = createClock()
    build()
  })

  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  const rawTask = (id: string) => db.$client.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as RawTask | undefined
  const rawTasks = () => db.$client.prepare('SELECT * FROM tasks ORDER BY id').all() as RawTask[]
  const rawMilestone = (id: string) => db.$client.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as RawMilestone | undefined
  const rawMilestones = () => db.$client.prepare('SELECT * FROM milestones ORDER BY id').all() as RawMilestone[]
  const rawProjects = () => db.$client.prepare('SELECT * FROM projects ORDER BY id').all()
  const initialOf = (projectId: string) => milestones.list().find((m) => m.projectId === projectId)!
  const at = (projectId: string, milestoneId?: string) => ({ projectId, milestoneId: milestoneId ?? initialOf(projectId).id })

  describe('新規プロジェクトと初期マイルストン', () => {
    it('作成時に「新しいマイルストン」を同じトランザクションで1件だけ作る（通常のマイルストン。名前変更・削除できる）', () => {
      const p = projects.create({ name: 'P' })
      const own = milestones.list().filter((m) => m.projectId === p.id)
      expect(own).toHaveLength(1)
      expect(own[0]).toMatchObject({ name: INITIAL_MILESTONE_NAME, projectId: p.id, createdAt: p.createdAt, updatedAt: p.createdAt })
      expect(INITIAL_MILESTONE_NAME).toBe('新しいマイルストン')
      expect(milestones.rename({ id: own[0]!.id, name: '設計' }).name).toBe('設計')
      // 2つ目のプロジェクトも1件ずつ（他のプロジェクトに作らない・重複しない）
      const q = projects.create({ name: 'Q' })
      expect(milestones.list().filter((m) => m.projectId === q.id)).toHaveLength(1)
      expect(milestones.list().filter((m) => m.projectId === p.id)).toHaveLength(1)
    })

    it('マイルストンの作成に失敗したら、プロジェクトも残らない（片方だけの状態を残さない）', () => {
      const failing = createProjectService({
        ...projectServiceDeps(db),
        insertMilestone: () => {
          throw new Error('書き込み失敗')
        }
      })
      expect(() => failing.create({ name: 'P' })).toThrow('書き込み失敗')
      expect(rawProjects()).toEqual([])
      expect(rawMilestones()).toEqual([])
    })
  })

  describe('所属ルール', () => {
    it('マイルストン0件のプロジェクトにはタスクを追加・紐付けできない。Inboxの作成・所属解除は従来どおり', () => {
      const p = projects.create({ name: 'P' })
      const initial = initialOf(p.id)
      milestones.delete({ id: initial.id, expectedTaskCount: 0 })
      expect(milestones.list().filter((m) => m.projectId === p.id)).toEqual([])
      const inbox = tasks.create({ title: 'inbox' })
      expect(inbox).toMatchObject({ projectId: null, milestoneId: null })
      expect(() => tasks.create({ title: 'x', projectId: p.id })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
      expect(() => tasks.create({ title: 'x', projectId: p.id, milestoneId: initial.id })).toThrow(/指定したマイルストンが見つかりません/)
      expect(() => tasks.setAssignment({ id: inbox.id, projectId: p.id, milestoneId: null })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
      expect(rawTask(inbox.id)).toMatchObject({ project_id: null, milestone_id: null, hidden_at: null, updated_at: inbox.updatedAt })
      // 新しくマイルストンを作れば追加できる。Inboxへ戻すのは通常の所属解除（非表示にしない）
      const m = milestones.create({ projectId: p.id, name: 'M' })
      const moved = tasks.setAssignment({ id: inbox.id, ...at(p.id, m.id) })
      expect(moved).toMatchObject({ projectId: p.id, milestoneId: m.id })
      const back = tasks.setAssignment({ id: inbox.id, projectId: null, milestoneId: null })
      expect(back).toMatchObject({ projectId: null, milestoneId: null })
      expect(rawTask(inbox.id)?.hidden_at).toBeNull()
      expect(tasks.list().map((t) => t.id)).toContain(inbox.id)
    })
  })

  describe('タスクの削除', () => {
    it('Inbox・プロジェクトのタスクを物理削除する。他のタスク・プロジェクトの状態は変えない（自動で完了しない）', () => {
      const p = projects.create({ name: 'P' })
      const inbox = tasks.create({ title: 'inbox' })
      const open = tasks.create({ title: 'open', ...at(p.id) })
      const done = tasks.create({ title: 'done', ...at(p.id) })
      tasks.setCompleted({ id: done.id, completed: true })
      const before = rawProjects()

      expect(tasks.delete({ id: inbox.id })).toEqual({ id: inbox.id })
      expect(rawTask(inbox.id)).toBeUndefined()
      // 未完了の最後の1件を削除しても、プロジェクトは未完了のまま
      expect(tasks.delete({ id: open.id })).toEqual({ id: open.id })
      expect(rawTask(open.id)).toBeUndefined()
      expect(rawProjects()).toEqual(before)
      expect(tasks.list().map((t) => t.id)).toEqual([done.id])
    })

    it('二重実行・存在しない・非表示のタスクは NOT_FOUND（何も変えない）', () => {
      const p = projects.create({ name: 'P' })
      const t = tasks.create({ title: 't', ...at(p.id) })
      tasks.delete({ id: t.id })
      expect(() => tasks.delete({ id: t.id })).toThrow(/対象のタスクが見つかりません/)
      expect(() => tasks.delete({ id: MISSING_ID })).toThrow(/対象のタスクが見つかりません/)
      const hidden = tasks.create({ title: 'hidden', ...at(p.id) })
      milestones.delete({ id: initialOf(p.id).id, expectedTaskCount: 1 })
      const snapshot = rawTask(hidden.id)
      expect(() => tasks.delete({ id: hidden.id })).toThrow(/対象のタスクが見つかりません/)
      expect(rawTask(hidden.id)).toEqual(snapshot)
    })

    it('削除後に遅れて届いた更新は対象を復活させない（NOT_FOUND）', () => {
      const t = tasks.create({ title: 't' })
      tasks.delete({ id: t.id })
      expect(() => tasks.updateTitle({ id: t.id, title: '遅延' })).toThrow(/対象のタスクが見つかりません/)
      expect(() => tasks.setCompleted({ id: t.id, completed: true })).toThrow(/対象のタスクが見つかりません/)
      expect(() => tasks.setAssignment({ id: t.id, projectId: null, milestoneId: null })).toThrow(/対象のタスクが見つかりません/)
      expect(rawTask(t.id)).toBeUndefined()
    })

    it('途中で失敗したら削除しない（ロールバック）', () => {
      const t = tasks.create({ title: 't' })
      const failing = createTaskService({
        ...taskServiceDeps(db),
        repository: {
          ...createTaskRepository(db),
          deleteVisible: (id: string) => {
            createTaskRepository(db).deleteVisible(id)
            throw new Error('書き込み失敗')
          }
        }
      })
      expect(() => failing.delete({ id: t.id })).toThrow('書き込み失敗')
      expect(rawTask(t.id)).toMatchObject({ id: t.id, title: 't' })
    })
  })

  describe('マイルストンの削除', () => {
    it('空のマイルストン: 最後の1件でも削除でき、代わりのマイルストンを自動で作らない', () => {
      const p = projects.create({ name: 'P' })
      const initial = initialOf(p.id)
      expect(milestones.getDeletionSummary({ id: initial.id })).toEqual({ id: initial.id, name: INITIAL_MILESTONE_NAME, taskCount: 0 })
      expect(milestones.delete({ id: initial.id, expectedTaskCount: 0 })).toEqual({ id: initial.id, hiddenTaskCount: 0 })
      expect(rawMilestone(initial.id)).toBeUndefined()
      expect(milestones.list()).toEqual([])
      // 再起動相当（再接続・マイグレーション再実行）でも作り直さない
      closeDatabase(db)
      db = openDatabase(dbFile)
      runMigrations(db, MIGRATIONS_DIR)
      build()
      expect(milestones.list()).toEqual([])
    })

    it('件数は完了済み・検索で隠れているタスクも含めてDBで数える（表示中の件数では判定しない）', () => {
      const p = projects.create({ name: 'P' })
      const m = initialOf(p.id)
      const done = tasks.create({ title: '完了済み', ...at(p.id) })
      tasks.setCompleted({ id: done.id, completed: true })
      expect(milestones.getDeletionSummary({ id: m.id }).taskCount).toBe(1)
      // 「表示中は0件」として削除しようとしても、DBに1件あれば何もしない
      expect(() => milestones.delete({ id: m.id, expectedTaskCount: 0 })).toThrow(
        expect.objectContaining({ code: 'CONFLICT', details: { kind: 'deletion-scope-changed' } })
      )
      expect(rawMilestone(m.id)).toBeDefined()
      expect(rawTask(done.id)).toMatchObject({ milestone_id: m.id, hidden_at: null })
    })

    it('タスクあり: タスクは削除せず milestone_id = NULL・project_id 維持・非表示にし、マイルストンは物理削除。ID・タイトル・完了・作成日時は変えない', () => {
      const p = projects.create({ name: 'P' })
      const m = initialOf(p.id)
      const keep = milestones.create({ projectId: p.id, name: '残す' })
      const t1 = tasks.create({ title: 't1', ...at(p.id) })
      const t2 = tasks.create({ title: 't2', ...at(p.id) })
      tasks.setCompleted({ id: t2.id, completed: true })
      const other = tasks.create({ title: 'other', ...at(p.id, keep.id) })
      const inbox = tasks.create({ title: 'inbox' })
      const before = { t1: rawTask(t1.id)!, t2: rawTask(t2.id)!, other: rawTask(other.id)!, inbox: rawTask(inbox.id)! }

      const result = milestones.delete({ id: m.id, expectedTaskCount: 2 })
      expect(result).toEqual({ id: m.id, hiddenTaskCount: 2 })
      expect(rawMilestone(m.id)).toBeUndefined()
      for (const key of ['t1', 't2'] as const) {
        const after = rawTask(before[key].id)!
        expect(after).toMatchObject({
          id: before[key].id,
          title: before[key].title,
          created_at: before[key].created_at,
          done_on: before[key].done_on,
          project_id: p.id,
          milestone_id: null
        })
        // 非表示化した日時 = 操作日時。所属が変わるため updated_at も同じ日時にする
        expect(after.hidden_at).not.toBeNull()
        expect(after.updated_at).toBe(after.hidden_at)
        expect(after.updated_at > before[key].updated_at).toBe(true)
      }
      expect(rawTask(other.id)).toEqual(before.other)
      expect(rawTask(inbox.id)).toEqual(before.inbox)
      // 非表示のタスクは一覧・件数・完了判定に含めない
      expect(tasks.list().map((t) => t.id).sort()).toEqual([other.id, inbox.id].sort())
      expect(createTaskRepository(db).countOpenByProject(p.id)).toBe(1) // other だけ
    })

    it('非表示になった未完了タスクは、プロジェクトの完了を妨げない', () => {
      const p = projects.create({ name: 'P' })
      tasks.create({ title: 'open', ...at(p.id) })
      expect(() => projects.setCompleted({ id: p.id, completed: true })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
      milestones.delete({ id: initialOf(p.id).id, expectedTaskCount: 1 })
      expect(projects.setCompleted({ id: p.id, completed: true }).doneOn).not.toBeNull()
    })

    it('完了済みプロジェクトのマイルストンも削除できる（プロジェクトの完了状態は変えない）', () => {
      const p = projects.create({ name: 'P' })
      const t = tasks.create({ title: 't', ...at(p.id) })
      tasks.setCompleted({ id: t.id, completed: true })
      const done = projects.setCompleted({ id: p.id, completed: true })
      milestones.delete({ id: initialOf(p.id).id, expectedTaskCount: 1 })
      expect(projects.list().find((x) => x.id === p.id)).toEqual(done)
    })

    it('途中で失敗したら、所属解除・非表示化も残さない（ロールバック）', () => {
      const p = projects.create({ name: 'P' })
      const m = initialOf(p.id)
      const t = tasks.create({ title: 't', ...at(p.id) })
      const before = rawTask(t.id)
      const failing = createMilestoneService({
        ...milestoneServiceDeps(db),
        repository: {
          ...createMilestoneRepository(db),
          deleteVisible: () => {
            throw new Error('書き込み失敗')
          }
        }
      })
      expect(() => failing.delete({ id: m.id, expectedTaskCount: 1 })).toThrow('書き込み失敗')
      expect(rawTask(t.id)).toEqual(before)
      expect(rawMilestone(m.id)).toBeDefined()
    })

    it('非表示のタスクは通常の更新APIで再表示・再利用できない（NOT_FOUND。旧所属にも戻らない）', () => {
      const p = projects.create({ name: 'P' })
      const m = initialOf(p.id)
      const m2 = milestones.create({ projectId: p.id, name: 'M2' })
      const t = tasks.create({ title: 't', ...at(p.id) })
      milestones.delete({ id: m.id, expectedTaskCount: 1 })
      const hidden = rawTask(t.id)
      expect(() => tasks.updateTitle({ id: t.id, title: 'u' })).toThrow(/対象のタスクが見つかりません/)
      expect(() => tasks.setCompleted({ id: t.id, completed: true })).toThrow(/対象のタスクが見つかりません/)
      expect(() => tasks.setAssignment({ id: t.id, projectId: null, milestoneId: null })).toThrow(/対象のタスクが見つかりません/)
      expect(() => tasks.setAssignment({ id: t.id, ...at(p.id, m2.id) })).toThrow(/対象のタスクが見つかりません/)
      // Repository の更新も hidden_at IS NULL を条件にしている（遅れて届いた更新が直接届いても変えない）
      expect(createTaskRepository(db).updateAssignment(t.id, p.id, m2.id, null, 'z')).toBeUndefined()
      expect(rawTask(t.id)).toEqual(hidden)
    })
  })

  describe('プロジェクトの削除', () => {
    it('マイルストン・タスクは削除せず所属を外して非表示にし、プロジェクトは物理削除する。既に非表示の所属タスクも処理する', () => {
      const p = projects.create({ name: 'P' })
      const q = projects.create({ name: 'Q' })
      const m1 = initialOf(p.id)
      const m2 = milestones.create({ projectId: p.id, name: 'M2' })
      const t1 = tasks.create({ title: 't1', ...at(p.id, m1.id) })
      const t2 = tasks.create({ title: 't2', ...at(p.id, m2.id) })
      tasks.setCompleted({ id: t2.id, completed: true })
      const earlier = tasks.create({ title: 'earlier', ...at(p.id, m2.id) })
      // 先にマイルストン（m3）を削除して非表示にしたタスク（project_id だけが残っている）
      const m3 = milestones.create({ projectId: p.id, name: 'M3' })
      const t3 = tasks.create({ title: 't3', ...at(p.id, m3.id) })
      milestones.delete({ id: m3.id, expectedTaskCount: 1 })
      const t3Hidden = rawTask(t3.id)!
      expect(t3Hidden).toMatchObject({ project_id: p.id, milestone_id: null })
      expect(t3Hidden.hidden_at).not.toBeNull()
      // 関係のないプロジェクト・Inbox
      const qTask = tasks.create({ title: 'q', ...at(q.id) })
      const inbox = tasks.create({ title: 'inbox' })
      const untouched = { q: rawTask(qTask.id), inbox: rawTask(inbox.id), qm: rawMilestone(initialOf(q.id).id) }
      const beforeT1 = rawTask(t1.id)!

      expect(projects.getDeletionSummary({ id: p.id })).toEqual({
        id: p.id,
        name: 'P',
        done: false,
        doneOn: null,
        milestoneCount: 2,
        taskCount: 4,
        hiddenTaskCount: 1
      })
      expect(projects.delete({ id: p.id, expectedMilestoneCount: 2, expectedTaskCount: 4 })).toEqual({
        id: p.id,
        milestoneCount: 2,
        taskCount: 4
      })

      expect(db.$client.prepare('SELECT id FROM projects').all()).toEqual([{ id: q.id }])
      for (const m of [m1, m2]) {
        expect(rawMilestone(m.id)).toMatchObject({ id: m.id, name: m.name, created_at: m.createdAt, project_id: null })
      }
      for (const t of [t1, t2, earlier, t3]) {
        const after = rawTask(t.id)!
        expect(after).toMatchObject({ id: t.id, title: t.title, created_at: t.createdAt, project_id: null, milestone_id: null })
        expect(after.hidden_at).not.toBeNull()
      }
      expect(rawTask(t2.id)?.done_on).not.toBeNull()
      expect(rawTask(t1.id)?.done_on).toBeNull()
      // 最初に非表示になった日時は保つ。所属が変わるので updated_at は操作日時
      expect(rawTask(t3.id)?.hidden_at).toBe(t3Hidden.hidden_at)
      expect(rawTask(t1.id)!.updated_at > beforeT1.updated_at).toBe(true)
      expect(rawTask(t1.id)!.hidden_at).toBe(rawTask(t1.id)!.updated_at)
      // 関係のないデータは変えない
      expect(rawTask(qTask.id)).toEqual(untouched.q)
      expect(rawTask(inbox.id)).toEqual(untouched.inbox)
      expect(rawMilestone(initialOf(q.id).id)).toEqual(untouched.qm)
      // 画面に出すAPIからは除外する（Inboxにも出さない）。通常のInboxタスクは表示し続ける
      expect(tasks.list().map((t) => t.id).sort()).toEqual([qTask.id, inbox.id].sort())
      expect(milestones.list().map((m) => m.projectId)).toEqual([q.id])
      expect(tasks.list().filter((t) => t.projectId === null).map((t) => t.id)).toEqual([inbox.id])
      // 非表示のマイルストンは名前変更・削除・紐付けの対象外
      expect(() => milestones.rename({ id: m1.id, name: 'x' })).toThrow(/対象のマイルストンが見つかりません/)
      expect(() => milestones.delete({ id: m1.id, expectedTaskCount: 0 })).toThrow(/対象のマイルストンが見つかりません/)
      expect(() => milestones.getDeletionSummary({ id: m1.id })).toThrow(/対象のマイルストンが見つかりません/)
      expect(() => tasks.setAssignment({ id: inbox.id, projectId: q.id, milestoneId: m1.id })).toThrow(/指定したマイルストンが見つかりません/)
      expect(() => milestones.create({ projectId: p.id, name: 'x' })).toThrow(/指定したプロジェクトが見つかりません/)
      expect(() => projects.delete({ id: p.id, expectedMilestoneCount: 0, expectedTaskCount: 0 })).toThrow(/対象のプロジェクトが見つかりません/)
      expect(db.$client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    })

    it('完了済みのプロジェクトも削除できる（完了の条件とは無関係）。未完了タスクがあっても削除できる', () => {
      const done = projects.create({ name: 'done' })
      const t = tasks.create({ title: 't', ...at(done.id) })
      tasks.setCompleted({ id: t.id, completed: true })
      projects.setCompleted({ id: done.id, completed: true })
      expect(projects.getDeletionSummary({ id: done.id }).doneOn).not.toBeNull()
      projects.delete({ id: done.id, expectedMilestoneCount: 1, expectedTaskCount: 1 })
      expect(projects.list()).toEqual([])

      const open = projects.create({ name: 'open' })
      tasks.create({ title: 'open-task', ...at(open.id) })
      projects.delete({ id: open.id, expectedMilestoneCount: 1, expectedTaskCount: 1 })
      expect(projects.list()).toEqual([])
      expect(tasks.list()).toEqual([])
    })

    it('確認後に配下の件数が変わっていたら、何も変えずに CONFLICT（削除範囲を無断で広げない）', () => {
      const p = projects.create({ name: 'P' })
      const summary = projects.getDeletionSummary({ id: p.id })
      tasks.create({ title: '後から追加', ...at(p.id) })
      const before = { tasks: rawTasks(), milestones: rawMilestones(), projects: rawProjects() }
      expect(() =>
        projects.delete({ id: p.id, expectedMilestoneCount: summary.milestoneCount, expectedTaskCount: summary.taskCount })
      ).toThrow(expect.objectContaining({ code: 'CONFLICT', details: { kind: 'deletion-scope-changed' } }))
      milestones.create({ projectId: p.id, name: '後から追加' })
      expect(() => projects.delete({ id: p.id, expectedMilestoneCount: 1, expectedTaskCount: 1 })).toThrow(
        expect.objectContaining({ details: { kind: 'deletion-scope-changed' } })
      )
      expect(rawTasks()).toEqual(before.tasks)
      expect(rawProjects()).toEqual(before.projects)
      expect(rawMilestones()).toHaveLength(before.milestones.length + 1)
    })

    it('途中で失敗したら、タスク・マイルストンの所属解除も残さない（ロールバック）', () => {
      const p = projects.create({ name: 'P' })
      tasks.create({ title: 't', ...at(p.id) })
      const before = { tasks: rawTasks(), milestones: rawMilestones(), projects: rawProjects() }
      const failing = createProjectService({
        ...projectServiceDeps(db),
        detachMilestones: (projectId: string, at: string) => {
          createMilestoneRepository(db).detachByProject(projectId, at)
          throw new Error('書き込み失敗')
        }
      })
      expect(() => failing.delete({ id: p.id, expectedMilestoneCount: 1, expectedTaskCount: 1 })).toThrow('書き込み失敗')
      expect({ tasks: rawTasks(), milestones: rawMilestones(), projects: rawProjects() }).toEqual(before)
    })

    it('非表示のデータは再接続（再起動）後も物理削除されず、非表示のまま', () => {
      const p = projects.create({ name: 'P' })
      const q = projects.create({ name: 'Q' })
      const a = tasks.create({ title: 'a', ...at(p.id) })
      const b = tasks.create({ title: 'b', ...at(q.id) })
      milestones.delete({ id: initialOf(q.id).id, expectedTaskCount: 1 }) // b: project_id あり・milestone_id NULL・非表示
      projects.delete({ id: p.id, expectedMilestoneCount: 1, expectedTaskCount: 1 })
      const snapshot = { tasks: rawTasks(), milestones: rawMilestones() }
      closeDatabase(db)
      db = openDatabase(dbFile)
      expect(runMigrations(db, MIGRATIONS_DIR)).toEqual({ appliedBefore: MIGRATION_COUNT, appliedAfter: MIGRATION_COUNT })
      build()
      expect({ tasks: rawTasks(), milestones: rawMilestones() }).toEqual(snapshot)
      expect(rawTask(b.id)).toMatchObject({ project_id: q.id, milestone_id: null })
      expect(rawTask(a.id)).toMatchObject({ project_id: null, milestone_id: null })
      expect(tasks.list()).toEqual([])
    })
  })

  it('IPCハンドラー経由: 不正な入力は INVALID_INPUT、件数のずれは型付きの details、存在しないものは NOT_FOUND', async () => {
    const policy: SenderPolicy = {
      getWindow: () => ({ isDestroyed: () => false, webContents: { id: 1 } }),
      isAllowedUrl: () => true
    }
    const event: InvokeEventLike = { sender: { id: 1 }, senderFrame: { url: 'file:///index.html', parent: null } }
    const logger = { warn: vi.fn(), error: vi.fn() }
    const deleteTask = createIpcHandler({ channel: 'tasks:delete', argsSchema: tasksDeleteArgsSchema, policy, logger, run: ([i]) => tasks.delete(i) })
    const deleteMilestone = createIpcHandler({ channel: 'milestones:delete', argsSchema: milestonesDeleteArgsSchema, policy, logger, run: ([i]) => milestones.delete(i) })
    const deleteProject = createIpcHandler({ channel: 'projects:delete', argsSchema: projectsDeleteArgsSchema, policy, logger, run: ([i]) => projects.delete(i) })
    const p = projects.create({ name: 'P' })
    tasks.create({ title: 't', ...at(p.id) })
    const m = initialOf(p.id)

    expect(await deleteTask(event, { id: 'x' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await deleteTask(event, { id: MISSING_ID, extra: 1 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await deleteTask(event, { id: MISSING_ID })).toEqual({ ok: false, error: { code: 'NOT_FOUND', message: '対象のタスクが見つかりません。' } })
    expect(await deleteMilestone(event, { id: m.id })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await deleteMilestone(event, { id: m.id, expectedTaskCount: -1 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await deleteMilestone(event, { id: m.id, expectedTaskCount: 0.5 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await deleteMilestone(event, { id: m.id, expectedTaskCount: 0 })).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        message: '確認した後に対象の件数が変わったため、削除しませんでした。内容を確認してください。',
        details: { kind: 'deletion-scope-changed' }
      }
    })
    expect(await deleteProject(event, { id: p.id, expectedMilestoneCount: 1 })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    expect(await deleteProject(event, { id: p.id, expectedMilestoneCount: 1, expectedTaskCount: 1 })).toEqual({
      ok: true,
      data: { id: p.id, milestoneCount: 1, taskCount: 1 }
    })
    expect(logger.error).not.toHaveBeenCalled()
  })
})

describe('移行（0005 → 0006）: プロジェクトだけに所属するタスクの一度限りの物理削除', () => {
  let temp: ReturnType<typeof createTempDir>
  beforeEach(() => {
    temp = createTempDir()
  })
  afterEach(() => temp.cleanup())

  it('project_id あり・milestone_id NULL のタスクだけを（完了済みも）削除し、Inbox・マイルストン所属済みと他の表は保持する', () => {
    const dbFile = join(temp.dir, 'gtd.sqlite')
    const oldDir = join(temp.dir, 'migrations-phase55')
    const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    const entries = journal.entries.slice(0, 6) // 0000〜0005（フェーズ5.5まで）
    mkdirSync(join(oldDir, 'meta'), { recursive: true })
    writeFileSync(join(oldDir, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
    for (const entry of entries) copyFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(oldDir, `${entry.tag}.sql`))

    const old = openDatabase(dbFile)
    expect(runMigrations(old, oldDir)).toEqual({ appliedBefore: 0, appliedAfter: 6 })
    const pid = '33333333-3333-4333-8333-333333333333'
    const mid = '44444444-4444-4444-8444-444444444444'
    old.$client.prepare('INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?)').run(pid, 'P', 'a', 'a', null)
    old.$client.prepare('INSERT INTO milestones (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(mid, pid, 'M', 'b', 'b')
    const insert = old.$client.prepare(
      'INSERT INTO tasks (id, title, created_at, updated_at, completed_at, project_id, milestone_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    const T = (n: number) => `00000000-0000-4000-8000-00000000000${n}`
    insert.run(T(1), 'プロジェクトだけ（未完了）', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', null, pid, null)
    insert.run(T(2), 'プロジェクトだけ（完了済み）', '2026-11-02T00:00:00.000Z', '2026-11-02T00:00:00.000Z', '2026-11-02T01:00:00.000Z', pid, null)
    insert.run(T(3), 'マイルストン所属', '2026-11-03T00:00:00.000Z', '2026-11-03T05:00:00.000Z', '2026-11-03T05:00:00.000Z', pid, mid)
    insert.run(T(4), 'Inbox', '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z', null, null, null)
    insert.run(T(5), 'Inbox（完了済み）', '2026-11-05T00:00:00.000Z', '2026-11-05T00:00:00.000Z', '2026-11-05T01:00:00.000Z', null, null)
    const before = old.$client.prepare('SELECT * FROM tasks ORDER BY id').all() as Record<string, unknown>[]
    const beforeMilestones = old.$client.prepare('SELECT * FROM milestones').all()
    const beforeProjects = old.$client.prepare('SELECT * FROM projects').all()
    closeDatabase(old)

    const upgraded = openDatabase(dbFile)
    expect(runMigrations(upgraded, MIGRATIONS_DIR)).toEqual({ appliedBefore: 6, appliedAfter: MIGRATION_COUNT })
    const after = upgraded.$client.prepare('SELECT * FROM tasks ORDER BY id').all()
    // 残すタスクは全列（updated_at を含む）そのまま。hidden_at はNULL（表示対象）
    // 0010 で completed_at は done_on へ名前を変える（値はそのまま）
    const renamed = ({ completed_at: doneOn, ...rest }: Record<string, unknown>) => ({ ...rest, done_on: doneOn })
    expect(after).toEqual(
      (/* 049-important-default */ (before.filter((t) => t.id !== T(1) && t.id !== T(2)).map((t) => ({ ...renamed(t), hidden_at: null, position: null, dueto: null, favorite: 0 })))).map((row) => ({ ...row, important: 0 }))
    )
    // 0007（フェーズ5.9）で手動順の列が加わる（既存の行はNULL）。それ以外の列は変えない
    expect(upgraded.$client.prepare('SELECT * FROM milestones').all()).toEqual(
      ((beforeMilestones as Record<string, unknown>[]).map((m) => ({ ...m, position: null, done: 0, done_on: null }))).map((row) => ({ ...row, favorite: 0 }))
    )
    expect(upgraded.$client.prepare('SELECT * FROM projects').all()).toEqual(
      ((beforeProjects as Record<string, unknown>[]).map((p) => ({ ...renamed(p), done: p['completed_at'] === null ? 0 : 1 }))).map((row) => ({ ...row, favorite: 0 }))
    )
    // milestones.project_id はNULL可。外部キー（tasks → milestones・milestones → projects）と索引は維持
    const columns = upgraded.$client.prepare('PRAGMA table_info(milestones)').all() as { name: string; notnull: number }[]
    expect(columns.find((c) => c.name === 'project_id')).toMatchObject({ notnull: 0 })
    expect(upgraded.$client.prepare('PRAGMA foreign_key_list(milestones)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'projects', from: 'project_id', to: 'id' })])
    )
    expect(upgraded.$client.prepare('PRAGMA foreign_key_list(tasks)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: 'milestones', from: 'milestone_id', to: 'id' })])
    )
    expect((upgraded.$client.prepare('PRAGMA index_list(milestones)').all() as { name: string }[]).map((i) => i.name)).toContain(
      'milestones_project_id_idx'
    )
    expect(upgraded.$client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(upgraded.$client.prepare("SELECT name FROM sqlite_master WHERE name LIKE '\\_\\_%' ESCAPE '\\' AND name != '__drizzle_migrations'").all()).toEqual([])
    // 外部キーは有効なまま（存在しないマイルストンは保存できない）
    expect(() => createTaskRepository(upgraded).updateAssignment(T(4), pid, MISSING_ID, null, 'x')).toThrow(/FOREIGN KEY/)

    // 移行後に（マイルストンの削除で）非表示になったタスクは、再起動しても物理削除しない（一度限りの移行）
    const milestonesService = createMilestoneService({ ...milestoneServiceDeps(upgraded) })
    milestonesService.delete({ id: mid, expectedTaskCount: 1 })
    const hidden = upgraded.$client.prepare('SELECT * FROM tasks WHERE id = ?').get(T(3)) as RawTask
    expect(hidden).toMatchObject({ project_id: pid, milestone_id: null })
    closeDatabase(upgraded)

    const restarted = openDatabase(dbFile)
    expect(runMigrations(restarted, MIGRATIONS_DIR)).toEqual({ appliedBefore: MIGRATION_COUNT, appliedAfter: MIGRATION_COUNT })
    expect(restarted.$client.prepare('SELECT * FROM tasks WHERE id = ?').get(T(3))).toEqual(hidden)
    expect(restarted.$client.prepare('SELECT COUNT(*) AS c FROM tasks').get()).toEqual({ c: 3 })
    closeDatabase(restarted)
  })
})
