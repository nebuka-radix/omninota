// フェーズ6: 期限（dueto。日付のみ）と Summary Review（一時DB・タイムゾーンを切り替えた日付の判定）。
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createMilestoneService, type MilestoneService } from '../../src/main/services/milestone-service'
import { createProjectService, type ProjectService } from '../../src/main/services/project-service'
import { createSummaryService } from '../../src/main/services/summary-service'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import {
  addDaysToDateOnly,
  isValidDateOnly,
  localDateOnly,
  msUntilNextLocalMidnight,
  summaryRanges
} from '../../src/shared/date-only'
import { tasksSetDueArgsSchema } from '../../src/shared/validation/tasks'
import { createTempDir, MIGRATIONS_DIR, milestoneServiceDeps, projectServiceDeps, taskServiceDeps } from '../helpers/temp-database'

const MISSING_ID = '00000000-0000-4000-8000-00000000ffff'
const originalTz = process.env['TZ']
const withTz = (tz: string) => {
  process.env['TZ'] = tz
}
afterEach(() => {
  if (originalTz === undefined) delete process.env['TZ']
  else process.env['TZ'] = originalTz
})

describe('日付のみの値（YYYY-MM-DD）', () => {
  it.each([
    ['2024-02-29', true],
    ['2023-02-29', false],
    ['2100-02-29', false],
    ['2000-02-29', true],
    ['2026-02-30', false],
    ['2026-04-31', false],
    ['2026-12-31', true],
    ['2026-13-01', false],
    ['2026-00-10', false],
    ['2026-1-01', false],
    ['2026-01-01T00:00', false],
    ['0000-01-01', false],
    ['', false]
  ])('%s の実在判定は %s（形式の確認だけでは受け入れない）', (value, valid) => {
    expect(isValidDateOnly(value)).toBe(valid)
    expect(tasksSetDueArgsSchema.safeParse([{ id: MISSING_ID, due: { kind: 'date', date: value } }]).success).toBe(valid)
  })

  it('暦日の加算: 月末・年末・うるう年をまたぐ（ミリ秒の加算ではない）', () => {
    expect(addDaysToDateOnly('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysToDateOnly('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDaysToDateOnly('2023-02-28', 1)).toBe('2023-03-01')
    expect(addDaysToDateOnly('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToDateOnly('2026-12-26', 7)).toBe('2027-01-02')
    expect(addDaysToDateOnly('2027-01-01', -1)).toBe('2026-12-31')
    expect(summaryRanges('2024-02-27')).toEqual({ today: '2024-02-27', tomorrow: '2024-02-28', weekStart: '2024-02-29', weekEnd: '2024-03-05' })
  })

  it('今日はローカルの暦日（UTCの日付と異なる時刻でも、ローカルの日付）', () => {
    withTz('Asia/Tokyo')
    // UTCでは 11/11 15:30、東京では 11/12 00:30
    expect(localDateOnly(new Date('2026-11-11T15:30:00.000Z'))).toBe('2026-11-12')
    // 東京の 0時ちょうど（UTC 15:00）は新しい日付、その1ミリ秒前は前日
    expect(localDateOnly(new Date('2026-11-11T15:00:00.000Z'))).toBe('2026-11-12')
    expect(localDateOnly(new Date('2026-11-11T14:59:59.999Z'))).toBe('2026-11-11')
    withTz('America/Los_Angeles')
    // UTCでは 11/12 03:00、ロサンゼルスでは 11/11 19:00
    expect(localDateOnly(new Date('2026-11-12T03:00:00.000Z'))).toBe('2026-11-11')
  })

  it('次のローカルの0時までの時間は、夏時間の切り替え日も暦どおり（24時間固定ではない）', () => {
    withTz('America/Los_Angeles')
    // 2026-11-01 は夏時間の終了日（25時間）。その日の 0:00（PDT）から翌日の 0:00（PST）まで
    expect(msUntilNextLocalMidnight(new Date('2026-11-01T07:00:00.000Z'))).toBe(25 * 3600 * 1000)
    withTz('Asia/Tokyo')
    expect(msUntilNextLocalMidnight(new Date('2026-11-11T14:59:59.000Z'))).toBe(1000)
  })
})

describe('期限の設定・変更・解除と Summary Review（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let db: AppDatabase
  let tasks: TaskService
  let projects: ProjectService
  let milestones: MilestoneService
  let clock = new Date('2026-11-11T03:00:00.000Z')
  let n = 0
  const summary = () => createSummaryService({ listDueBetween: createTaskRepository(db).listDueBetween, now: () => clock }).get()
  const raw = (id: string) => db.$client.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>

  beforeEach(() => {
    withTz('Asia/Tokyo')
    temp = createTempDir()
    db = openDatabase(join(temp.dir, 'gtd.sqlite'))
    runMigrations(db, MIGRATIONS_DIR)
    n = 0
    clock = new Date('2026-11-11T03:00:00.000Z') // 東京 11/11 12:00
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

  it('今日・明日は操作の時点のローカルの暦日。日付指定・解除。期限だけを更新し、同じ期限では updatedAt を変えない', () => {
    const p = projects.create({ name: 'P' })
    const m = milestones.list().find((x) => x.projectId === p.id)!
    const t = tasks.create({ title: 't', projectId: p.id, milestoneId: m.id })
    tasks.reorderInMilestone({ milestoneId: m.id, orderedIds: [t.id] })
    tasks.setCompleted({ id: t.id, completed: false })
    const before = raw(t.id)
    clock = new Date('2026-11-11T15:30:00.000Z') // 東京では 11/12（UTCでは 11/11）
    const today = tasks.setDue({ id: t.id, due: { kind: 'today' } })
    expect(today.dueto).toBe('2026-11-12')
    expect(raw(t.id)).toEqual({ ...before, dueto: '2026-11-12', updated_at: clock.toISOString() })
    // 同じ期限の再設定は変更なし
    clock = new Date('2026-11-11T16:00:00.000Z')
    expect(tasks.setDue({ id: t.id, due: { kind: 'date', date: '2026-11-12' } }).updatedAt).toBe(today.updatedAt)
    // 明日（年末をまたぐ）
    clock = new Date('2026-12-31T14:00:00.000Z') // 東京 12/31 23:00
    expect(tasks.setDue({ id: t.id, due: { kind: 'tomorrow' } }).dueto).toBe('2027-01-01')
    // 過去の日付・うるう日
    expect(tasks.setDue({ id: t.id, due: { kind: 'date', date: '2024-02-29' } }).dueto).toBe('2024-02-29')
    // 解除
    const cleared = tasks.setDue({ id: t.id, due: { kind: 'clear' } })
    expect(cleared.dueto).toBeNull()
    const after = raw(t.id)
    expect({ ...after, dueto: null, updated_at: null }).toEqual({ ...before, dueto: null, updated_at: null })
  })

  it('非表示・削除済みのタスクには保存しない（遅れた保存で作り直さない）', () => {
    const p = projects.create({ name: 'P' })
    const m = milestones.create({ projectId: p.id, name: 'M' })
    const hidden = tasks.create({ title: 'h', projectId: p.id, milestoneId: m.id })
    milestones.delete({ id: m.id, expectedTaskCount: 1 })
    const before = raw(hidden.id)
    expect(() => tasks.setDue({ id: hidden.id, due: { kind: 'today' } })).toThrow(/見つかりません/)
    expect(raw(hidden.id)).toEqual(before)
    const gone = tasks.create({ title: 'g' })
    tasks.delete({ id: gone.id })
    expect(() => tasks.setDue({ id: gone.id, due: { kind: 'tomorrow' } })).toThrow(/見つかりません/)
    expect(raw(gone.id)).toBeUndefined()
  })

  it('Summary: 今日・明日・明後日〜7日後（両端を含む）に振り分け、昨日以前・8日後・期限なし・完了済み・非表示を除く。Inboxも含む', () => {
    const p = projects.create({ name: '案件' })
    const m = milestones.list().find((x) => x.projectId === p.id)!
    const hiddenMilestone = milestones.create({ projectId: p.id, name: '消すM' })
    const make = (title: string, date: string | null, inProject = false) => {
      const t = inProject ? tasks.create({ title, projectId: p.id, milestoneId: m.id }) : tasks.create({ title })
      if (date) tasks.setDue({ id: t.id, due: { kind: 'date', date } })
      return t
    }
    // 東京 11/11 12:00 が今日
    make('昨日', '2026-11-10')
    const today = make('今日', '2026-11-11', true)
    make('明日', '2026-11-12')
    make('明後日', '2026-11-13')
    make('7日後', '2026-11-18')
    make('8日後', '2026-11-19')
    make('期限なし', null)
    const done = make('完了済み', '2026-11-11')
    tasks.setCompleted({ id: done.id, completed: true })
    const hidden = tasks.create({ title: '非表示', projectId: p.id, milestoneId: hiddenMilestone.id })
    tasks.setDue({ id: hidden.id, due: { kind: 'date', date: '2026-11-11' } })
    milestones.delete({ id: hiddenMilestone.id, expectedTaskCount: 1 })
    const result = summary()
    expect(result.today).toBe('2026-11-11')
    expect(result.todayItems.map((x) => x.title)).toEqual(['今日'])
    expect(result.todayItems[0]).toMatchObject({ id: today.id, projectName: '案件', milestoneName: m.name, dueto: '2026-11-11' })
    expect(result.tomorrowItems.map((x) => x.title)).toEqual(['明日'])
    expect(result.tomorrowItems[0]).toMatchObject({ projectName: null, milestoneName: null })
    expect(result.thisWeekItems.map((x) => x.title)).toEqual(['明後日', '7日後'])
  })

  it('Summary: 同名・同じ期限でも別のタスクとして残し、期限 → 作成日時 → ID の順。0時ちょうどで日付が切り替わる', () => {
    const a = tasks.create({ title: '同名' })
    clock = new Date(clock.getTime() + 1000)
    const b = tasks.create({ title: '同名' })
    const c = tasks.create({ title: '同名' }) // b と同時刻（IDの昇順）
    for (const t of [c, b, a]) tasks.setDue({ id: t.id, due: { kind: 'date', date: '2026-11-13' } })
    const early = tasks.create({ title: '期限が早い' })
    tasks.setDue({ id: early.id, due: { kind: 'date', date: '2026-11-12' } })
    // 東京 11/11 23:59:59.999 → 明日は 11/12、This Week は 11/13〜
    clock = new Date('2026-11-11T14:59:59.999Z')
    let result = summary()
    expect(result.tomorrowItems.map((x) => x.id)).toEqual([early.id])
    expect(result.thisWeekItems.map((x) => x.id)).toEqual([a.id, b.id, c.id])
    // 0時ちょうど（UTC 15:00）→ 今日は 11/12
    clock = new Date('2026-11-11T15:00:00.000Z')
    result = summary()
    expect(result.today).toBe('2026-11-12')
    expect(result.todayItems.map((x) => x.id)).toEqual([early.id])
    expect(result.tomorrowItems.map((x) => x.id)).toEqual([a.id, b.id, c.id])
  })

  it('Summary: 月末・年末・うるう年の境界（7日後を含み、8日後を含まない）', () => {
    const at = (date: string) => {
      const t = tasks.create({ title: date })
      tasks.setDue({ id: t.id, due: { kind: 'date', date } })
    }
    for (const date of ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-05', '2024-03-06', '2026-12-31', '2027-01-01', '2027-01-07', '2027-01-08']) at(date)
    clock = new Date('2024-02-27T03:00:00.000Z') // 東京 2024-02-27
    let result = summary()
    expect([result.todayItems, result.tomorrowItems, result.thisWeekItems].map((list) => list.map((x) => x.dueto))).toEqual([
      ['2024-02-27'],
      ['2024-02-28'],
      ['2024-02-29', '2024-03-05']
    ])
    clock = new Date('2026-12-31T03:00:00.000Z') // 東京 2026-12-31
    result = summary()
    expect([result.todayItems, result.tomorrowItems, result.thisWeekItems].map((list) => list.map((x) => x.dueto))).toEqual([
      ['2026-12-31'],
      ['2027-01-01'],
      ['2027-01-07']
    ])
  })
})

describe('migration 0008（期限）', () => {
  it('既存のタスクは保持し、dueto は NULL。索引あり', () => {
    const temp = createTempDir()
    try {
      const db = openDatabase(join(temp.dir, 'gtd.sqlite'))
      runMigrations(db, MIGRATIONS_DIR)
      const columns = db.$client.prepare('PRAGMA table_info(tasks)').all() as { name: string; type: string; notnull: number }[]
      expect(columns.find((c) => c.name === 'dueto')).toMatchObject({ type: 'TEXT', notnull: 0 })
      expect((db.$client.prepare('PRAGMA index_list(tasks)').all() as { name: string }[]).map((i) => i.name)).toContain('tasks_dueto_idx')
      closeDatabase(db)
    } finally {
      temp.cleanup()
    }
  })
})
