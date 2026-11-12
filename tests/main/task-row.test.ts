// TaskRow（共通のタスク行）: お気に入り（favorite・0009）、期限の表示、Summary Review の振り分けの共通化、お気に入りの保存の順序制御。
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createTaskRepository } from '../../src/main/repositories/task-repository'
import { createSummaryService } from '../../src/main/services/summary-service'
import { createTaskService, type TaskService } from '../../src/main/services/task-service'
import type { SummaryItem } from '../../src/shared/contracts/summary'
import type { TaskDto } from '../../src/shared/contracts/tasks'
import { diffDateOnlyDays } from '../../src/shared/date-only'
import { splitSummary } from '../../src/shared/summary-sections'
import { tasksSetFavoriteArgsSchema } from '../../src/shared/validation/tasks'
import { createFavoriteSaver } from '../../src/renderer/src/features/tasks/favorite-saver'
import { createTaskSaveQueue } from '../../src/renderer/src/features/tasks/task-save-queue'
import { dueLabelOf } from '../../src/renderer/src/features/tasks/due-format'
import { mergeSummary } from '../../src/renderer/src/features/summary/summary-merge'
import { createTempDir, MIGRATIONS_DIR, taskServiceDeps } from '../helpers/temp-database'

const ID = '00000000-0000-4000-8000-000000000001'

describe('お気に入りの入力検証', () => {
  it.each([
    [{ id: ID, favorite: true }, true],
    [{ id: ID, favorite: false }, true],
    [{ id: ID, favorite: 1 }, false],
    [{ id: ID, favorite: 'true' }, false],
    [{ id: ID, favorite: null }, false],
    [{ id: ID }, false],
    [{ id: 'x', favorite: true }, false],
    [{ id: ID, favorite: true, title: '他の項目' }, false]
  ])('%j は %s（真偽値だけ。他の項目を受け付けない）', (input, ok) => {
    expect(tasksSetFavoriteArgsSchema.safeParse([input]).success).toBe(ok)
  })
})

describe('お気に入り（Service・一時DB）', () => {
  let temp: ReturnType<typeof createTempDir>
  let db: AppDatabase
  let tasks: TaskService
  let clock = new Date('2026-11-11T03:00:00.000Z')
  let n = 0
  const raw = (id: string) => db.$client.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined

  beforeEach(() => {
    temp = createTempDir()
    db = openDatabase(join(temp.dir, 'gtd.sqlite'))
    runMigrations(db, MIGRATIONS_DIR)
    n = 0
    clock = new Date('2026-11-11T03:00:00.000Z')
    tasks = createTaskService({ ...taskServiceDeps(db), now: () => clock, generateId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}` })
  })
  afterEach(() => {
    closeDatabase(db)
    temp.cleanup()
  })

  it('新しいタスクは false（INTEGER の 0）。設定・解除はお気に入りだけを更新し、同じ値では updatedAt を変えない', () => {
    const task = tasks.create({ title: 'A' })
    expect(task.favorite).toBe(false)
    expect(raw(task.id)).toMatchObject({ favorite: 0 })
    tasks.setDue({ id: task.id, due: { kind: 'today' } })
    tasks.setCompleted({ id: task.id, completed: true })
    const before = raw(task.id)!

    clock = new Date('2026-11-11T04:00:00.000Z')
    const on = tasks.setFavorite({ id: task.id, favorite: true })
    expect(on.favorite).toBe(true)
    expect(raw(task.id)).toEqual({ ...before, favorite: 1, updated_at: '2026-11-11T04:00:00.000Z' })

    clock = new Date('2026-11-11T05:00:00.000Z')
    expect(tasks.setFavorite({ id: task.id, favorite: true })).toEqual(on)
    expect(raw(task.id)!['updated_at']).toBe('2026-11-11T04:00:00.000Z')

    const off = tasks.setFavorite({ id: task.id, favorite: false })
    expect(off.favorite).toBe(false)
    expect(raw(task.id)).toMatchObject({ favorite: 0, title: 'A', dueto: before['dueto'], done_on: before['done_on'] })
    expect(tasks.list().find((item) => item.id === task.id)?.favorite).toBe(false)
  })

  it('削除済み・非表示のタスクには保存しない（作り直さない）', () => {
    const task = tasks.create({ title: 'A' })
    tasks.delete({ id: task.id })
    expect(() => tasks.setFavorite({ id: task.id, favorite: true })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    expect(raw(task.id)).toBeUndefined()
    const hidden = tasks.create({ title: 'B' })
    db.$client.prepare('UPDATE tasks SET hidden_at = ? WHERE id = ?').run('2026-11-11T00:00:00.000Z', hidden.id)
    expect(() => tasks.setFavorite({ id: hidden.id, favorite: true })).toThrow(expect.objectContaining({ code: 'NOT_FOUND' }))
    expect(raw(hidden.id)).toMatchObject({ favorite: 0 })
  })

  it('Summary の行はタスクDTO（お気に入りを含む）と所属の名前', () => {
    const task = tasks.create({ title: 'A' })
    tasks.setDue({ id: task.id, due: { kind: 'today' } })
    tasks.setFavorite({ id: task.id, favorite: true })
    const summary = createSummaryService({ listDueOnOrBefore: createTaskRepository(db).listDueOnOrBefore, now: () => clock })
    const today = summary.get().todayItems
    expect(today).toHaveLength(1)
    expect(today[0]).toMatchObject({ id: task.id, title: 'A', favorite: true, doneOn: null, projectName: null, milestoneName: null })
    expect(summary.today()).toBe(summary.get().today)
  })
})

describe('migration 0009（お気に入り）', () => {
  it('既存のタスクを保持し、favorite は NOT NULL・既定値 false（0）', () => {
    const temp = createTempDir()
    try {
      // 0008 までのDBに、当時の列だけでタスクを登録してから最新まで適用する
      const partial = join(temp.dir, 'migrations-0008')
      const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
      const index = journal.entries.findIndex((entry) => entry.tag === '0009_task_favorite')
      expect(index).toBeGreaterThan(0)
      const entries = journal.entries.slice(0, index)
      mkdirSync(join(partial, 'meta'), { recursive: true })
      writeFileSync(join(partial, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries }))
      for (const entry of entries) copyFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), join(partial, `${entry.tag}.sql`))
      const file = join(temp.dir, 'gtd.sqlite')
      const old = openDatabase(file)
      runMigrations(old, partial)
      old.$client.prepare('INSERT INTO tasks (id, title, created_at, updated_at, dueto) VALUES (?, ?, ?, ?, ?)').run(ID, '既存', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-12')
      closeDatabase(old)

      const db = openDatabase(file)
      runMigrations(db, MIGRATIONS_DIR)
      const column = (db.$client.prepare('PRAGMA table_info(tasks)').all() as { name: string; type: string; notnull: number; dflt_value: string | null }[]).find(
        (c) => c.name === 'favorite'
      )
      expect(column).toMatchObject({ type: 'INTEGER', notnull: 1 })
      expect(db.$client.prepare('SELECT title, dueto, favorite, updated_at FROM tasks WHERE id = ?').get(ID)).toEqual({
        title: '既存',
        dueto: '2026-11-12',
        favorite: 0,
        updated_at: '2026-11-01T00:00:00.000Z'
      })
      expect(createTaskRepository(db).listAll()[0]?.favorite).toBe(false)
      expect(() => db.$client.prepare('UPDATE tasks SET favorite = NULL WHERE id = ?').run(ID)).toThrow()
      closeDatabase(db)
    } finally {
      temp.cleanup()
    }
  })
})

describe('期限の表示（TaskRow）', () => {
  it('ローカルの暦日の差: Today / Tomorrow / {N}Days、昨日以前は日付（期限超過）、未設定は null', () => {
    expect(dueLabelOf('2026-11-12', '2026-11-12')).toMatchObject({ kind: 'today', text: 'Today' })
    expect(dueLabelOf('2026-11-13', '2026-11-12')).toMatchObject({ kind: 'tomorrow', text: 'Tomorrow' })
    expect(dueLabelOf('2026-11-14', '2026-11-12')).toMatchObject({ kind: 'days', text: '2Days' })
    expect(dueLabelOf('2027-01-01', '2026-12-31')).toMatchObject({ kind: 'tomorrow' })
    expect(dueLabelOf('2027-03-01', '2027-02-27')).toMatchObject({ kind: 'days', text: '2Days' })
    expect(dueLabelOf('2028-03-01', '2028-02-28')).toMatchObject({ kind: 'days', text: '2Days' })
    expect(dueLabelOf('2026-11-11', '2026-11-12')).toMatchObject({ kind: 'overdue', text: '11/11(水)' })
    expect(dueLabelOf('2025-12-31', '2026-01-01')).toMatchObject({ kind: 'overdue', text: '2025/12/31(水)' })
    expect(dueLabelOf('2025-12-31', '2026-01-01')?.description).toContain('期限超過')
    expect(dueLabelOf(null, '2026-11-12')).toBeNull()
  })

  it('暦日の差は夏時間の切り替え日をまたいでも整数（時刻の差ではない）', () => {
    const original = process.env['TZ']
    process.env['TZ'] = 'America/Los_Angeles'
    try {
      expect(diffDateOnlyDays('2026-03-07', '2026-03-09')).toBe(2)
      expect(diffDateOnlyDays('2026-11-01', '2026-10-31')).toBe(-1)
      expect(diffDateOnlyDays('2026-12-31', '2027-01-07')).toBe(7)
    } finally {
      if (original === undefined) delete process.env['TZ']
      else process.env['TZ'] = original
    }
  })
})

const task = (id: string, patch: Partial<TaskDto> = {}): TaskDto => ({
  id,
  title: id,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  doneOn: null,
  projectId: null,
  milestoneId: null,
  position: null,
  dueto: '2026-11-12',
  favorite: false,
  ...patch
})
const item = (id: string, patch: Partial<TaskDto> = {}): SummaryItem => {
  const base = task(id, patch)
  return { ...base, dueto: base.dueto ?? '', projectName: null, milestoneName: null }
}

describe('Summary の振り分け（Main・Renderer 共通）', () => {
  it('今日・明日・明後日〜7日後。完了・範囲外を除き、期限 → 作成日時 → ID の順', () => {
    const result = splitSummary(
      [
        item('b', { dueto: '2026-11-14' }),
        item('a', { dueto: '2026-11-14' }),
        item('c', { dueto: '2026-11-19' }),
        item('d', { dueto: '2026-11-20' }),
        item('e', { dueto: '2026-11-11' }),
        item('f', { dueto: '2026-11-12', doneOn: '2026-11-11T00:00:00.000Z' }),
        item('g', { dueto: '2026-11-13' }),
        item('h', { dueto: '2026-11-12', createdAt: '2026-10-01T00:00:00.000Z' }),
        item('i', { dueto: '2026-11-12' })
      ],
      '2026-11-12'
    )
    expect(result.todayItems.map((x) => x.id)).toEqual(['h', 'i'])
    expect(result.tomorrowItems.map((x) => x.id)).toEqual(['g'])
    expect(result.thisWeekItems.map((x) => x.id)).toEqual(['a', 'b', 'c'])
  })

  it('保存後の値（一覧の Query）を重ねて振り分け直す: 完了・削除は外し、期限の変更は移動、所属の変更だけでは外さない', () => {
    const summary = splitSummary([item('a'), item('b'), item('c'), item('d'), item('e', { dueto: '2026-11-13' })], '2026-11-12')
    const later = '2026-11-12T00:00:00.000Z'
    const merged = mergeSummary(summary, [
      task('a', { doneOn: later, updatedAt: later }),
      task('b', { dueto: '2026-11-15', updatedAt: later }),
      task('c', { projectId: 'p', milestoneId: 'm', updatedAt: later }),
      // d は削除済み（一覧にない）
      task('e', { dueto: null, updatedAt: later })
    ])
    expect(merged.todayItems.map((x) => x.id)).toEqual(['c'])
    expect(merged.todayItems[0]).toMatchObject({ projectId: 'p', milestoneId: 'm' })
    expect(merged.tomorrowItems).toEqual([])
    expect(merged.thisWeekItems.map((x) => x.id)).toEqual(['b'])
    // 一覧の Query が古い（Summary の方が新しい）場合は Summary の値を使う
    const stale = mergeSummary(splitSummary([item('a', { updatedAt: later, favorite: true })], '2026-11-12'), [task('a')])
    expect(stale.todayItems[0]?.favorite).toBe(true)
    // 一覧の Query が未取得なら、Summary の取得結果のまま
    expect(mergeSummary(summary, undefined).todayItems.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('お気に入りの保存の順序制御（favorite-saver）', () => {
  // 保存のたびに手動で応答を返せる偽の Main
  const setup = () => {
    const queue = createTaskSaveQueue()
    const db = new Map<string, boolean>([['t', false]])
    const calls: boolean[] = []
    const pending: { resolve: () => void; reject: (e: Error) => void }[] = []
    const saved: boolean[] = []
    const errors: string[] = []
    const saver = createFavoriteSaver<{ id: string; favorite: boolean }>({
      enqueue: (id, save) => queue.run(id, save),
      save: (id, favorite) =>
        new Promise((resolve, reject) => {
          calls.push(favorite)
          pending.push({
            resolve: () => {
              db.set(id, favorite)
              resolve({ id, favorite })
            },
            reject
          })
        }),
      onSaved: (result) => saved.push(result.favorite),
      onError: (_id, error) => errors.push((error as Error).message)
    })
    const flush = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }
    return { queue, db, calls, pending, saved, errors, saver, flush }
  }

  it('連打しても保存中は待ちを1つにまとめ、最後に押した状態を保存する（表示は押した直後から目的の状態）', async () => {
    const { db, calls, pending, saved, saver, flush } = setup()
    saver.toggle('t', false)
    expect(saver.desired('t')).toBe(true)
    await flush()
    expect(calls).toEqual([true])
    // 保存中に4回押す（true → false → true → false → true）
    saver.toggle('t', false)
    saver.toggle('t', false)
    saver.toggle('t', false)
    saver.toggle('t', false)
    expect(saver.desired('t')).toBe(true)
    pending[0]!.resolve()
    await flush()
    // 最初の保存（true）と目的の状態（true）が同じなので、追加の保存はしない
    expect(calls).toEqual([true])
    expect(saver.desired('t')).toBeUndefined()
    expect(db.get('t')).toBe(true)
    expect(saved).toEqual([true])

    // 保存中に1回押す → 終わった後にもう1回だけ保存する
    saver.toggle('t', true)
    await flush()
    expect(calls).toEqual([true, false])
    saver.toggle('t', true)
    expect(saver.desired('t')).toBe(true)
    pending[1]!.resolve()
    await flush()
    expect(calls).toEqual([true, false, true])
    pending[2]!.resolve()
    await flush()
    expect(db.get('t')).toBe(true)
    expect(saver.desired('t')).toBeUndefined()
  })

  it('同じタスクの他の保存（タイトルなど）の後に順番に実行する', async () => {
    const { queue, calls, pending, saver, flush } = setup()
    let releaseTitle!: () => void
    const order: string[] = []
    void queue.run('t', () => new Promise<void>((resolve) => (releaseTitle = () => (order.push('title'), resolve()))))
    saver.toggle('t', false)
    await flush()
    expect(calls).toEqual([])
    releaseTitle()
    await flush()
    expect(order).toEqual(['title'])
    expect(calls).toEqual([true])
    pending[0]!.resolve()
    await flush()
    expect(await queue.waitForIdle()).toBe(true)
  })

  it('失敗したら目的の状態を捨て（保存済みの値の表示に戻す）、理由を渡す', async () => {
    const { calls, pending, errors, saver, flush } = setup()
    saver.toggle('t', false)
    await flush()
    saver.toggle('t', false)
    pending[0]!.reject(new Error('NOT_FOUND'))
    await flush()
    expect(errors).toEqual(['NOT_FOUND'])
    expect(saver.desired('t')).toBeUndefined()
    expect(calls).toEqual([true])
  })
})
