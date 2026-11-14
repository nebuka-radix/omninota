import { constructTable, tableFeatures, type SortingState } from '@tanstack/react-table'
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings'
import { describe, expect, it } from 'vitest'
import { assignmentValue, buildAssignmentOptions, parseAssignmentValue } from '../../src/renderer/src/features/tasks/assignment'
import { createTaskSaveQueue } from '../../src/renderer/src/features/tasks/task-save-queue'
import { INBOX_SCOPE, isTaskInScope, scopeProjectId, taskScopeKey, type TaskScope } from '../../src/renderer/src/features/tasks/task-scope'
import {
  DEFAULT_TASK_SORTING,
  scopeAndStatusFilterState,
  taskColumns,
  taskTableFeatures,
  taskTableOptions,
  type TaskStatusFilter
} from '../../src/renderer/src/features/tasks/task-table'
import type { ProjectDto } from '../../src/shared/contracts/projects'
import type { TaskDto } from '../../src/shared/contracts/tasks'

const P1 = '00000000-0000-4000-8000-000000000001'
const P2 = '00000000-0000-4000-8000-000000000002'

const task = (id: string, title: string, projectId: string | null, completed = false, createdAt = '2026-11-10T00:00:00.000Z'): TaskDto => ({
  id,
  title,
  createdAt,
  updatedAt: createdAt,
  doneOn: completed ? '2026-11-10T01:00:00.000Z' : null,
  projectId,
  milestoneId: null,
  position: null,
  dueto: null, favorite: false
})

describe('表示範囲（Inbox / プロジェクト）', () => {
  it('Inboxは未所属、プロジェクトはそのプロジェクトのタスクだけ', () => {
    const project: TaskScope = { kind: 'project', projectId: P1 }
    expect(isTaskInScope(task('a', 'a', null), INBOX_SCOPE)).toBe(true)
    expect(isTaskInScope(task('a', 'a', P1), INBOX_SCOPE)).toBe(false)
    expect(isTaskInScope(task('a', 'a', P1), project)).toBe(true)
    expect(isTaskInScope(task('a', 'a', P2), project)).toBe(false)
    expect(isTaskInScope(task('a', 'a', null), project)).toBe(false)
  })

  it('作成時の所属先: Inboxはnull、プロジェクトはそのID', () => {
    expect(scopeProjectId(INBOX_SCOPE)).toBeNull()
    expect(scopeProjectId({ kind: 'project', projectId: P1 })).toBe(P1)
  })

  it('範囲の識別子は範囲ごとに異なる', () => {
    expect(new Set([taskScopeKey(INBOX_SCOPE), taskScopeKey({ kind: 'project', projectId: P1 }), taskScopeKey({ kind: 'project', projectId: P2 })]).size).toBe(3)
  })
})

describe('Table: 表示範囲と状態・検索・ソートの組み合わせ', () => {
  const headlessFeatures = tableFeatures({ ...taskTableFeatures, coreReactivityFeature: storeReactivityBindings() })
  const data: TaskDto[] = [
    task('i1', '牛乳', null, false, '2026-11-10T00:00:01.000Z'),
    task('i2', '牛乳パック', null, true, '2026-11-10T00:00:02.000Z'),
    task('p1', '牛乳の資料', P1, false, '2026-11-10T00:00:03.000Z'),
    task('p2', '会議', P1, true, '2026-11-10T00:00:04.000Z'),
    task('q1', '牛乳', P2, false, '2026-11-10T00:00:05.000Z')
  ]
  const ids = (scope: TaskScope, options: { status?: TaskStatusFilter; search?: string; sorting?: SortingState } = {}) =>
    constructTable({
      features: headlessFeatures,
      columns: taskColumns,
      data,
      ...taskTableOptions,
      state: {
        sorting: options.sorting ?? DEFAULT_TASK_SORTING,
        globalFilter: options.search ?? '',
        columnFilters: scopeAndStatusFilterState(scope, options.status ?? 'all')
      }
    })
      .getRowModel()
      .rows.map((row) => row.id)

  it('範囲だけ', () => {
    expect(ids(INBOX_SCOPE)).toEqual(['i2', 'i1'])
    expect(ids({ kind: 'project', projectId: P1 })).toEqual(['p2', 'p1'])
    expect(ids({ kind: 'project', projectId: P2 })).toEqual(['q1'])
  })

  it('範囲 × 状態 × 検索 × ソート', () => {
    expect(ids(INBOX_SCOPE, { status: 'open', search: '牛乳' })).toEqual(['i1'])
    expect(ids(INBOX_SCOPE, { status: 'completed' })).toEqual(['i2'])
    expect(ids({ kind: 'project', projectId: P1 }, { search: '牛乳' })).toEqual(['p1'])
    expect(ids({ kind: 'project', projectId: P1 }, { sorting: [{ id: 'title', desc: false }] })).toEqual(['p2', 'p1'])
    expect(ids(INBOX_SCOPE, { sorting: [{ id: 'createdAt', desc: false }] })).toEqual(['i1', 'i2'])
  })
})

describe('詳細パネルの所属の選択肢（5.4でプロジェクト・マイルストンの1つの選択に拡張）', () => {
  const project = (id: string, name: string, createdAt: string, doneOn: string | null = null): ProjectDto => ({
    favorite: false,
    id,
    name,
    createdAt,
    updatedAt: createdAt,
    done: doneOn !== null,
    doneOn
  })
  const work1 = project('aaaaaaaa-0000-4000-8000-000000000001', '仕事', '2026-11-01T00:00:00.000Z')
  const work2 = project('bbbbbbbb-0000-4000-8000-000000000002', '仕事', '2026-11-02T00:00:00.000Z')
  const home = project('cccccccc-0000-4000-8000-000000000003', '家', '2026-11-03T00:00:00.000Z')
  const done = project('dddddddd-0000-4000-8000-000000000004', '完了P', '2026-11-04T00:00:00.000Z', '2026-11-05T00:00:00.000Z')
  const values = (built: ReturnType<typeof buildAssignmentOptions>) => [
    built.unassigned.value,
    ...built.groups.flatMap((group) => group.options.map((option) => option.value))
  ]
  const none = { projectId: null, milestoneId: null }

  const milestoneOf = (projectId: string, id: string) => ({
    id,
    projectId,
    name: 'M',
    createdAt: '2026-11-06T00:00:00.000Z',
    updatedAt: '2026-11-06T00:00:00.000Z',
    done: false,
    doneOn: null,
    position: null
  })
  const mWork = milestoneOf(work1.id, 'ffffffff-0000-4000-8000-000000000011')
  const mHome = milestoneOf(home.id, 'ffffffff-0000-4000-8000-000000000012')
  const mDone = milestoneOf(done.id, 'ffffffff-0000-4000-8000-000000000013')

  it('未所属と未完了プロジェクトのマイルストンを選べる（プロジェクトだけは選べない）。完了済みは候補に出さない', () => {
    const built = buildAssignmentOptions([work1, home, done], [mWork, mHome, mDone], none)
    expect(values(built)).toEqual(['', `${home.id}:${mHome.id}`, `${work1.id}:${mWork.id}`])
    expect(built.unassigned).toEqual({ value: '', label: '未所属（Inbox）', disabled: false })
    expect(built.groups.flatMap((group) => group.options).every((option) => !option.disabled)).toBe(true)
  })

  it('同名のプロジェクトはIDで区別し、作成日時とIDの先頭を補助情報として付ける', () => {
    const built = buildAssignmentOptions([work2, work1, home], [], none)
    const labels = built.groups.map((group) => group.label)
    expect(labels.filter((label) => label.includes('ID aaaaaaaa'))).toHaveLength(1)
    expect(labels.filter((label) => label.includes('ID bbbbbbbb'))).toHaveLength(1)
    expect(labels).toContain('家')
    expect(new Set(values(built)).size).toBe(values(built).length)
  })

  it('現在の所属が完了済みなら、その名前を「完了済み」として表示する（選択不可。空欄・未所属に見せない）', () => {
    const built = buildAssignmentOptions([work1, done], [mWork, mDone], { projectId: done.id, milestoneId: mDone.id })
    const option = built.groups.flatMap((group) => group.options).find((item) => item.value === `${done.id}:${mDone.id}`)
    expect(option).toEqual({ value: `${done.id}:${mDone.id}`, label: '完了P（完了済み） › M', disabled: true })
    expect(built.unknown).toBeNull()
  })

  it('一覧にない所属は「不明」として値を保つ', () => {
    const missing = 'eeeeeeee-0000-4000-8000-000000000005'
    expect(buildAssignmentOptions([work1], [], { projectId: missing, milestoneId: null }).unknown).toEqual({
      value: `${missing}:`,
      label: '不明なプロジェクト・マイルストン',
      disabled: true
    })
  })

  it('選択値の変換（空文字 = 未所属、"<P>:<M>" = マイルストン。"<P>:" は5.6で選択肢から外したが、変換の規則は残す）', () => {
    expect(parseAssignmentValue('')).toEqual(none)
    expect(parseAssignmentValue(`${work1.id}:`)).toEqual({ projectId: work1.id, milestoneId: null })
    expect(parseAssignmentValue(`${work1.id}:m1`)).toEqual({ projectId: work1.id, milestoneId: 'm1' })
    expect(assignmentValue({ projectId: work1.id, milestoneId: 'm1' })).toBe(`${work1.id}:m1`)
  })
})

describe('同じタスクの更新を順番に実行する（task-save-queue）', () => {
  const deferred = <T,>() => {
    let resolve!: (value: T) => void
    let reject!: (reason: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('同じタスクは前の更新が終わってから実行し、応答も実行順に届く（古い応答で新しい値を上書きしない）', async () => {
    const queue = createTaskSaveQueue()
    const order: string[] = []
    const first = deferred<string>()
    const a = queue.run('t1', () => (order.push('start project'), first.promise))
    const b = queue.run('t1', async () => (order.push('start title'), 'title-saved'))
    const results: string[] = []
    void a.then((value) => results.push(value))
    void b.then((value) => results.push(value))
    await tick()
    expect(order).toEqual(['start project']) // タイトルの保存は所属の保存を待つ
    first.resolve('project-saved')
    await b
    expect(order).toEqual(['start project', 'start title'])
    expect(results).toEqual(['project-saved', 'title-saved'])
  })

  it('前の更新が失敗しても、次の更新は実行する。別のタスクは待たない', async () => {
    const queue = createTaskSaveQueue()
    const blocker = deferred<string>()
    const failed = queue.run('t1', async () => {
      throw new Error('失敗')
    })
    const next = queue.run('t1', async () => 'ok')
    const other = queue.run('t2', () => blocker.promise)
    await expect(failed).rejects.toThrow('失敗')
    await expect(next).resolves.toBe('ok')
    blocker.resolve('other')
    await expect(other).resolves.toBe('other')
  })

  it('waitForIdle: 進行中の更新が終わるまで待ち、1つでも失敗していればfalse。何もなければすぐtrue', async () => {
    const queue = createTaskSaveQueue()
    expect(await queue.waitForIdle()).toBe(true)
    const pending = deferred<string>()
    void queue.run('t1', () => pending.promise)
    let settled: boolean | null = null
    void queue.waitForIdle().then((value) => (settled = value))
    await tick()
    expect(settled).toBeNull()
    pending.resolve('ok')
    await tick()
    await tick()
    expect(settled).toBe(true)

    const failing = deferred<string>()
    const run = queue.run('t1', () => failing.promise)
    run.catch(() => {})
    const waiting = queue.waitForIdle()
    failing.reject(new Error('保存失敗'))
    expect(await waiting).toBe(false)
    // 終わった失敗は、次の待機には影響しない
    expect(await queue.waitForIdle()).toBe(true)
  })
})
