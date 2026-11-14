// 完了管理（0010）: tasks.done_on（completed_at から名前を変更）、projects.done / done_on、milestones.done / done_on。
// Summary Review の Overdue と、右サイドバーのプロジェクトのフィルター（表示だけ）。
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createMilestoneService, type MilestoneService } from '../../src/main/services/milestone-service'
import { createProjectService, type ProjectService } from '../../src/main/services/project-service'
import { createSummaryService } from '../../src/main/services/summary-service'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import type { SummaryItem } from '../../src/shared/contracts/summary'
import { splitSummary } from '../../src/shared/summary-sections'
import { filterSummaryByProjects, summaryTotal } from '../../src/renderer/src/features/summary/summary-merge'
import { createTempDir, inProject, MIGRATIONS_DIR, milestoneServiceDeps, projectServiceDeps, taskServiceDeps } from '../helpers/temp-database'

type Row = Record<string, unknown>

// 先頭から tag の直前までのマイグレーションだけのフォルダー（過去のスキーマのDBの再現）
function migrationsBefore(dir: string, tag: string): string {
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
  const index = journal.entries.findIndex((entry) => entry.tag === tag)
  expect(index).toBeGreaterThan(0)
  const entries = journal.entries.slice(0, index)
  const folder = join(dir, `migrations-before-${tag}`)
  mkdirSync(join(folder, 'meta'), { recursive: true })
  writeFileSync(join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
  for (const entry of entries) copyFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  return folder
}

const P_OPEN = '10000000-0000-4000-8000-000000000001'
const P_DONE = '10000000-0000-4000-8000-000000000002'
const M_OPEN = '20000000-0000-4000-8000-000000000001'
const M_DONE = '20000000-0000-4000-8000-000000000002'
const M_DETACHED = '20000000-0000-4000-8000-000000000003'
const T = (n: number) => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('migration 0010（completed_at → done_on、projects.done、milestones.done / done_on）', () => {
  it('0009 のDBから: 完了日時・ID・所属・期限・お気に入り・手動順・非表示を保持し、完了済みプロジェクトは done = true。日時の列は移行だけでは変えない。外部キー・索引も整合', () => {
    const temp = createTempDir()
    try {
      const file = join(temp.dir, 'gtd.sqlite')
      const old = openDatabase(file)
      runMigrations(old, migrationsBefore(temp.dir, '0010_done_and_done_on'))
      const sql = old.$client
      sql.prepare('INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?)').run(P_OPEN, '未完了', 'p-c1', 'p-u1', null)
      sql.prepare('INSERT INTO projects (id, name, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?)').run(P_DONE, '完了済み', 'p-c2', 'p-u2', '2026-11-05T01:02:03.004Z')
      const insertMilestone = sql.prepare('INSERT INTO milestones (id, project_id, name, created_at, updated_at, position) VALUES (?, ?, ?, ?, ?, ?)')
      insertMilestone.run(M_OPEN, P_OPEN, 'M1', 'm-c1', 'm-u1', 0)
      insertMilestone.run(M_DONE, P_DONE, 'M2', 'm-c2', 'm-u2', null)
      insertMilestone.run(M_DETACHED, null, '削除由来', 'm-c3', 'm-u3', null)
      const insertTask = sql.prepare(
        'INSERT INTO tasks (id, title, created_at, updated_at, completed_at, project_id, milestone_id, hidden_at, position, dueto, favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      insertTask.run(T(1), '完了', 't-c1', 't-u1', '2026-11-06T00:00:00.000Z', P_OPEN, M_OPEN, null, 3, '2026-11-12', 1)
      insertTask.run(T(2), '未完了', 't-c2', 't-u2', null, null, null, null, null, null, 0)
      insertTask.run(T(3), '非表示の完了', 't-c3', 't-u3', '2026-11-07T00:00:00.000Z', P_DONE, null, '2026-11-08T00:00:00.000Z', null, '2026-11-01', 1)
      insertTask.run(T(4), '完了プロジェクトのタスク', 't-c4', 't-u4', '2026-11-04T00:00:00.000Z', P_DONE, M_DONE, null, null, null, 0)
      const before = {
        tasks: sql.prepare('SELECT * FROM tasks ORDER BY id').all() as Row[],
        projects: sql.prepare('SELECT * FROM projects ORDER BY id').all() as Row[],
        milestones: sql.prepare('SELECT * FROM milestones ORDER BY id').all() as Row[]
      }
      closeDatabase(old)

      const db = openDatabase(file)
      runMigrations(db, MIGRATIONS_DIR)
      const after = (table: string) => db.$client.prepare(`SELECT * FROM ${table} ORDER BY id`).all() as Row[]
      const rename = ({ completed_at: doneOn, ...rest }: Row) => ({ ...rest, done_on: doneOn })
      expect(after('tasks')).toEqual(before.tasks.map(rename))
      expect(after('projects')).toEqual((before.projects.map((row) => ({ ...rename(row), done: row['completed_at'] === null ? 0 : 1 }))).map((row) => ({ ...row, favorite: 0 })))
      expect(after('milestones')).toEqual(before.milestones.map((row) => ({ ...row, done: 0, done_on: null })))
      // 旧列は残さない
      for (const table of ['tasks', 'projects']) {
        const columns = (db.$client.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
        expect(columns).toContain('done_on')
        expect(columns).not.toContain('completed_at')
      }
      expect((db.$client.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name)).not.toContain('done')
      const doneColumn = (table: string) => (db.$client.prepare(`PRAGMA table_info(${table})`).all() as { name: string; type: string; notnull: number; dflt_value: string }[]).find((c) => c.name === 'done')
      expect(doneColumn('projects')).toMatchObject({ type: 'INTEGER', notnull: 1 })
      expect(doneColumn('milestones')).toMatchObject({ type: 'INTEGER', notnull: 1 })
      // 外部キー・索引・整合性
      expect(db.$client.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      expect(db.$client.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      expect(db.$client.prepare('PRAGMA foreign_key_list(tasks)').all()).toEqual(
        expect.arrayContaining([expect.objectContaining({ table: 'projects', from: 'project_id' }), expect.objectContaining({ table: 'milestones', from: 'milestone_id' })])
      )
      expect((db.$client.prepare('PRAGMA index_list(tasks)').all() as { name: string }[]).map((i) => i.name)).toEqual(
        expect.arrayContaining(['tasks_created_at_id_idx', 'tasks_project_id_idx', 'tasks_milestone_id_idx', 'tasks_dueto_idx'])
      )
      // Repository・Service から見た値（非表示のタスクは一覧に出さないが、行は残る）
      const tasks = createTaskService({ ...taskServiceDeps(db) })
      expect(tasks.list().map((t) => [t.id, t.doneOn])).toEqual([
        [T(4), '2026-11-04T00:00:00.000Z'],
        [T(2), null],
        [T(1), '2026-11-06T00:00:00.000Z']
      ])
      expect(after('tasks').find((row) => row['id'] === T(3))).toMatchObject({ hidden_at: '2026-11-08T00:00:00.000Z', done_on: '2026-11-07T00:00:00.000Z' })
      const projects = createProjectService({ ...projectServiceDeps(db) })
      expect(projects.list().map((p) => [p.id, p.done, p.doneOn, p.updatedAt])).toEqual([
        [P_OPEN, false, null, 'p-u1'],
        [P_DONE, true, '2026-11-05T01:02:03.004Z', 'p-u2']
      ])
      closeDatabase(db)
    } finally {
      temp.cleanup()
    }
  })
})

describe('完了管理（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let db: AppDatabase
  let tasks: TaskService
  let projects: ProjectService
  let milestones: MilestoneService
  let clock = new Date('2026-11-11T03:00:00.000Z')
  let n = 0
  const raw = (table: string, id: string) => db.$client.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Row

  beforeEach(() => {
    temp = createTempDir()
    db = openDatabase(join(temp.dir, 'gtd.sqlite'))
    runMigrations(db, MIGRATIONS_DIR)
    n = 0
    clock = new Date('2026-11-11T03:00:00.000Z')
    const now = () => clock
    const generateId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
    tasks = createTaskService({ ...taskServiceDeps(db), now, generateId })
    projects = createProjectService({ ...projectServiceDeps(db), now, generateId })
    milestones = createMilestoneService({ ...milestoneServiceDeps(db), now, generateId })
  })
  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  it('新しいプロジェクト・マイルストンは done = false・done_on = NULL', () => {
    const p = projects.create({ name: 'P' })
    expect(p).toMatchObject({ done: false, doneOn: null })
    expect(raw('projects', p.id)).toMatchObject({ done: 0, done_on: null })
    const initial = milestones.list().find((m) => m.projectId === p.id)!
    expect(initial).toMatchObject({ done: false, doneOn: null })
    const m = milestones.create({ projectId: p.id, name: 'M' })
    expect(m).toMatchObject({ done: false, doneOn: null })
    expect(raw('milestones', m.id)).toMatchObject({ done: 0, done_on: null })
  })

  it('タスク: 完了で done_on を記録、同じ状態の再要求では変えない、取り消しで NULL（done は done_on の有無）', () => {
    const t = tasks.create({ title: 'A' })
    expect(t.doneOn).toBeNull()
    clock = new Date('2026-11-11T04:00:00.000Z')
    const done = tasks.setCompleted({ id: t.id, completed: true })
    expect(done).toMatchObject({ doneOn: '2026-11-11T04:00:00.000Z', updatedAt: '2026-11-11T04:00:00.000Z' })
    clock = new Date('2026-11-11T05:00:00.000Z')
    expect(tasks.setCompleted({ id: t.id, completed: true })).toEqual(done)
    expect(raw('tasks', t.id)).toMatchObject({ done_on: '2026-11-11T04:00:00.000Z', updated_at: '2026-11-11T04:00:00.000Z' })
    const reopened = tasks.setCompleted({ id: t.id, completed: false })
    expect(reopened).toMatchObject({ doneOn: null, updatedAt: '2026-11-11T05:00:00.000Z' })
    clock = new Date('2026-11-11T06:00:00.000Z')
    expect(tasks.setCompleted({ id: t.id, completed: false })).toEqual(reopened)
    expect(raw('tasks', t.id)).toMatchObject({ done_on: null, updated_at: '2026-11-11T05:00:00.000Z' })
  })

  it('プロジェクト: done と done_on を同じ更新で切り替え、同じ状態では日時を変えない。未完了タスクがあれば完了できない', () => {
    const p = projects.create({ name: 'P' })
    const t = tasks.create({ title: 't', ...inProject(db, p.id) })
    expect(() => projects.setCompleted({ id: p.id, completed: true })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(raw('projects', p.id)).toMatchObject({ done: 0, done_on: null })
    tasks.setCompleted({ id: t.id, completed: true })
    clock = new Date('2026-11-11T07:00:00.000Z')
    const done = projects.setCompleted({ id: p.id, completed: true })
    expect(done).toMatchObject({ done: true, doneOn: '2026-11-11T07:00:00.000Z', updatedAt: '2026-11-11T07:00:00.000Z' })
    expect(raw('projects', p.id)).toMatchObject({ done: 1, done_on: '2026-11-11T07:00:00.000Z' })
    clock = new Date('2026-11-11T08:00:00.000Z')
    expect(projects.setCompleted({ id: p.id, completed: true })).toEqual(done)
    // 完了済みプロジェクトの制約（マイルストン・タスクの追加不可、タスクの再開不可）は done で判定する
    expect(() => milestones.create({ projectId: p.id, name: 'x' })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(() => tasks.create({ title: 'x', ...inProject(db, p.id) })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    expect(() => tasks.setCompleted({ id: t.id, completed: false })).toThrow(expect.objectContaining({ code: 'CONFLICT' }))
    const reopened = projects.setCompleted({ id: p.id, completed: false })
    expect(reopened).toMatchObject({ done: false, doneOn: null, updatedAt: '2026-11-11T08:00:00.000Z' })
    expect(raw('projects', p.id)).toMatchObject({ done: 0, done_on: null })
    expect(projects.setCompleted({ id: p.id, completed: false })).toEqual(reopened)
    // マイルストンは自動で完了しない
    expect(milestones.list().every((m) => m.done === false && m.doneOn === null)).toBe(true)
    // done と done_on の整合（全行）
    const inconsistent = db.$client.prepare('SELECT COUNT(*) AS n FROM projects WHERE (done = 1) <> (done_on IS NOT NULL)').get() as { n: number }
    expect(inconsistent.n).toBe(0)
  })

  it('Summary の Overdue: 昨日以前の未完了すべて（過去の日数の制限なし）。今日は含めない。期限 → 作成日時 → ID の順。完了・非表示は除く', () => {
    const make = (title: string, date: string) => {
      const t = tasks.create({ title })
      tasks.setDue({ id: t.id, due: { kind: 'date', date } })
      clock = new Date(clock.getTime() + 1000)
      return t
    }
    const old = make('ずっと前', '2001-01-01')
    const yesterday = make('昨日', '2026-11-10')
    const today = make('今日', '2026-11-11')
    const done = make('完了', '2026-11-09')
    tasks.setCompleted({ id: done.id, completed: true })
    const hidden = make('非表示', '2026-11-09')
    db.$client.prepare('UPDATE tasks SET hidden_at = ? WHERE id = ?').run('x', hidden.id)
    const sameDay = make('昨日2', '2026-11-10')
    const summary = createSummaryService({ listDueOnOrBefore: createTaskRepository(db).listDueOnOrBefore, now: () => new Date('2026-11-11T03:00:00.000Z') }).get()
    expect(summary.overdueItems.map((x) => x.id)).toEqual([old.id, yesterday.id, sameDay.id])
    expect(summary.todayItems.map((x) => x.id)).toEqual([today.id])
  })
})

const item = (id: string, projectId: string | null, dueto: string): SummaryItem => ({
  id,
  title: id,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  doneOn: null,
  projectId,
  milestoneId: projectId ? 'm' : null,
  position: null,
  dueto,
  favorite: false,
  projectName: null,
  milestoneName: null
})

describe('Summary のプロジェクトのフィルター（表示だけ）', () => {
  it('OFF のプロジェクトのタスクを4区画すべてから外し、Inbox のタスクは残す。件数はフィルター後の合計', () => {
    const summary = splitSummary(
      [item('a', 'P', '2026-11-12'), item('b', null, '2026-11-12'), item('c', 'P', '2026-11-13'), item('d', 'Q', '2026-11-14'), item('e', 'P', '2026-11-01'), item('f', null, '2026-11-01')],
      '2026-11-12'
    )
    expect(summaryTotal(summary)).toBe(6)
    const filtered = filterSummaryByProjects(summary, new Set(['P']))
    expect(filtered.todayItems.map((x) => x.id)).toEqual(['b'])
    expect(filtered.tomorrowItems).toEqual([])
    expect(filtered.thisWeekItems.map((x) => x.id)).toEqual(['d'])
    expect(filtered.overdueItems.map((x) => x.id)).toEqual(['f'])
    expect(summaryTotal(filtered)).toBe(3)
    expect(filterSummaryByProjects(summary, new Set())).toBe(summary)
  })
})
