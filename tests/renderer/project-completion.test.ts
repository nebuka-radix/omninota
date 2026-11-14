import { describe, expect, it } from 'vitest'
import { groupProjects } from '../../src/renderer/src/features/projects/project-order'
import {
  initialStatusForProject,
  matchesTitleSearch,
  REOPEN_BLOCKED_REASON,
  reopenBlockedReason,
  shouldClearSearchToRevealOpen
} from '../../src/renderer/src/features/tasks/task-rules'
import { createTaskSaveQueue, projectSaveKey } from '../../src/renderer/src/features/tasks/task-save-queue'
import { INBOX_SCOPE } from '../../src/renderer/src/features/tasks/task-scope'
import type { ProjectDto } from '../../src/shared/contracts/projects'
import type { TaskDto } from '../../src/shared/contracts/tasks'

const P = '00000000-0000-4000-8000-000000000001'
const Q = '00000000-0000-4000-8000-000000000002'
const project = (id: string, name: string, createdAt: string, doneOn: string | null = null): ProjectDto => ({
  favorite: false,
  id,
  name,
  createdAt,
  updatedAt: createdAt,
  done: doneOn !== null,
  doneOn
})
const task = (title: string, projectId: string | null, completed = false): TaskDto => ({
  id: `${title}-id`,
  title,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  doneOn: completed ? '2026-11-10T01:00:00.000Z' : null,
  projectId,
  milestoneId: null,
  position: null,
  dueto: null, favorite: false
})

describe('サイドバーの区分（未完了・完了済み）', () => {
  it('区分ごとに、名前順・同名は作成日時・IDの順', () => {
    const projects = [
      project('c', '仕事', '2026-11-02T00:00:00.000Z', '2026-11-05T00:00:00.000Z'),
      project('b', '仕事', '2026-11-01T00:00:00.000Z'),
      project('a', '仕事', '2026-11-01T00:00:00.000Z'),
      project('d', 'あ', '2026-11-03T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
      project('e', '家 10', '2026-11-03T00:00:00.000Z'),
      project('f', '家 9', '2026-11-03T00:00:00.000Z')
    ]
    const groups = groupProjects(projects)
    expect(groups.open.map((p) => p.id)).toEqual(['f', 'e', 'a', 'b'])
    expect(groups.completed.map((p) => p.id)).toEqual(['d', 'c'])
  })

  it('完了すると完了済みの区分へ移り、取り消すと未完了へ戻る（IDは変わらない）', () => {
    const open = project('a', 'A', '2026-11-01T00:00:00.000Z')
    expect(groupProjects([open]).open.map((p) => p.id)).toEqual(['a'])
    const done = { ...open, done: true, doneOn: '2026-11-10T00:00:00.000Z' }
    expect(groupProjects([done])).toEqual({ open: [], completed: [done] })
  })
})

describe('プロジェクト画面の状態フィルターの初期値', () => {
  it('未完了のプロジェクトは「未完了」、完了済みは「完了」', () => {
    expect(initialStatusForProject({ done: false })).toBe('open')
    expect(initialStatusForProject({ done: true })).toBe('completed')
  })
})

describe('完了済みプロジェクトのタスクを未完了に戻せない理由', () => {
  const projects = [
    { id: P, done: true },
    { id: Q, done: false }
  ]
  it('完了済みプロジェクトに所属する完了タスクだけ理由を返す', () => {
    expect(reopenBlockedReason(task('a', P, true), projects)).toBe(REOPEN_BLOCKED_REASON)
    expect(reopenBlockedReason(task('a', P, false), projects)).toBeNull() // 完了にするのは常に可能
    expect(reopenBlockedReason(task('a', Q, true), projects)).toBeNull()
    expect(reopenBlockedReason(task('a', null, true), projects)).toBeNull()
  })

  it('プロジェクト一覧が未取得なら判定しない（Main側で判定する）', () => {
    expect(reopenBlockedReason(task('a', P, true), undefined)).toBeNull()
  })
})

describe('「未完了のタスクを表示」で検索をクリアするか', () => {
  const tasks = [task('資料を作る', P), task('会議', P), task('完了した資料', P, true), task('資料（別）', Q)]
  const scope = { kind: 'project' as const, projectId: P }

  it('範囲内の未完了タスクが検索で隠れる場合だけクリアする', () => {
    expect(shouldClearSearchToRevealOpen(tasks, scope, '')).toBe(false)
    expect(shouldClearSearchToRevealOpen(tasks, scope, '資料')).toBe(true) // 「会議」が隠れる
    expect(shouldClearSearchToRevealOpen([tasks[0] as TaskDto, tasks[2] as TaskDto], scope, '資料')).toBe(false)
    expect(shouldClearSearchToRevealOpen(tasks, INBOX_SCOPE, '資料')).toBe(false) // Inboxには未所属のタスクがない
  })

  it('一致の規則は大文字・小文字を区別しない部分一致', () => {
    expect(matchesTitleSearch('Report 提出', 'report')).toBe(true)
    expect(matchesTitleSearch('Report 提出', '  ')).toBe(true)
    expect(matchesTitleSearch('Report 提出', '会議')).toBe(false)
  })
})

describe('プロジェクトの更新（名前・完了状態）の直列化', () => {
  it('同じプロジェクトの名前変更と完了は順番に実行され、後の応答が最新になる。キーはタスクIDと重ならない', async () => {
    const queue = createTaskSaveQueue()
    const order: string[] = []
    let releaseRename!: () => void
    const renameDone = new Promise<void>((resolve) => (releaseRename = resolve))
    const rename = queue.run(projectSaveKey(P), async () => {
      order.push('rename:start')
      await renameDone
      order.push('rename:end')
      return { name: '新しい名前', doneOn: null }
    })
    const complete = queue.run(projectSaveKey(P), async () => {
      order.push('complete')
      return { name: '新しい名前', doneOn: '2026-11-10T00:00:00.000Z' }
    })
    // 同じIDのタスクの更新は待たない
    await expect(queue.run(P, async () => 'task')).resolves.toBe('task')
    expect(order).toEqual(['rename:start'])
    releaseRename()
    const results = await Promise.all([rename, complete])
    expect(order).toEqual(['rename:start', 'rename:end', 'complete'])
    expect(results.at(-1)).toEqual({ name: '新しい名前', doneOn: '2026-11-10T00:00:00.000Z' })
    expect(projectSaveKey(P)).not.toBe(P)
  })
})
