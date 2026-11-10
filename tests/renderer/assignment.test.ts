import { describe, expect, it } from 'vitest'
import {
  buildAssignmentOptions,
  buildTaskGroups,
  flattenRows,
  groupKey,
  sameAssignment,
  UNSET_GROUP_KEY
} from '../../src/renderer/src/features/tasks/assignment'
import type { MilestoneDto } from '../../src/shared/contracts/milestones'
import type { ProjectDto } from '../../src/shared/contracts/projects'
import type { TaskDto } from '../../src/shared/contracts/tasks'

const P = 'aaaaaaaa-0000-4000-8000-000000000001'
const Q = 'bbbbbbbb-0000-4000-8000-000000000002'
const project = (id: string, name: string, completedAt: string | null = null): ProjectDto => ({
  id,
  name,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  completedAt
})
const milestone = (id: string, projectId: string, name: string, createdAt: string): MilestoneDto => ({
  id,
  projectId,
  name,
  createdAt,
  updatedAt: createdAt
})
const task = (id: string, milestoneId: string | null, projectId: string | null = P): TaskDto => ({
  id,
  title: id,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  completedAt: null,
  projectId,
  milestoneId
})

const m1 = milestone('11111111-0000-4000-8000-000000000001', P, 'M1', '2026-11-02T00:00:00.000Z')
const m2 = milestone('22222222-0000-4000-8000-000000000002', P, 'M2', '2026-11-01T00:00:00.000Z')
const mSame = milestone('33333333-0000-4000-8000-000000000003', P, 'M1', '2026-11-03T00:00:00.000Z')
const mq = milestone('44444444-0000-4000-8000-000000000004', Q, 'MQ', '2026-11-01T00:00:00.000Z')

describe('マイルストン別のグループ', () => {
  it('マイルストンは作成順、最後に「マイルストン未設定」。空のグループも残す。タスクの並びは渡した順（ソート済み）', () => {
    const groups = buildTaskGroups([task('t1', m1.id), task('t2', null), task('t3', m1.id)], [m1, m2])
    expect(groups.map((group) => [group.key, group.label, group.tasks.map((t) => t.id)])).toEqual([
      [groupKey(m2.id), 'M2', []],
      [groupKey(m1.id), 'M1', ['t1', 't3']],
      [UNSET_GROUP_KEY, 'マイルストン未設定', ['t2']]
    ])
  })

  it('マイルストン0件でも「マイルストン未設定」のグループがある', () => {
    expect(buildTaskGroups([], []).map((group) => group.key)).toEqual([UNSET_GROUP_KEY])
  })

  it('同名のマイルストンは判別できるラベルにする。一覧にないマイルストンのタスクは「未設定」に表示（失わない）', () => {
    const groups = buildTaskGroups([task('t1', 'missing-milestone')], [m1, mSame])
    const labels = groups.slice(0, 2).map((group) => group.label)
    expect(labels[0]).not.toBe(labels[1])
    expect(labels.every((label) => label.startsWith('M1（'))).toBe(true)
    expect(groups.at(-1)?.tasks.map((t) => t.id)).toEqual(['t1'])
  })
})

describe('仮想化のためのフラットな行モデル', () => {
  it('見出し行とタスク行を並べ、キーは見出し "group:..." とタスクIDで衝突しない。キーボード移動の順はタスク行だけ', () => {
    const groups = buildTaskGroups([task('t1', m1.id), task('t2', null)], [m1])
    const { rows, orderedTasks } = flattenRows([], groups)
    expect(rows.map((row) => [row.kind, row.key])).toEqual([
      ['header', groupKey(m1.id)],
      ['task', 't1'],
      ['header', UNSET_GROUP_KEY],
      ['task', 't2']
    ])
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
    expect(orderedTasks.map((t) => t.id)).toEqual(['t1', 't2'])
    expect(rows.filter((row) => row.kind === 'task').map((row) => (row.kind === 'task' ? [row.taskIndex, row.groupLabel] : null))).toEqual([
      [0, 'M1'],
      [1, 'マイルストン未設定']
    ])
  })

  it('グループなし（Inbox）はタスク行だけ', () => {
    const { rows, orderedTasks } = flattenRows([task('a', null, null), task('b', null, null)], null)
    expect(rows.map((row) => row.kind)).toEqual(['task', 'task'])
    expect(orderedTasks).toHaveLength(2)
  })
})

describe('詳細パネルの選択肢（マイルストンを含む）', () => {
  it('プロジェクトごとに「マイルストン未設定」とマイルストン（作成順）を並べる。他プロジェクトのマイルストンは混ぜない', () => {
    const built = buildAssignmentOptions([project(P, 'P'), project(Q, 'Q')], [m1, m2, mq], { projectId: null, milestoneId: null })
    expect(built.groups.map((group) => group.options.map((option) => option.value))).toEqual([
      [`${P}:`, `${P}:${m2.id}`, `${P}:${m1.id}`],
      [`${Q}:`, `${Q}:${mq.id}`]
    ])
  })

  it('完了済みプロジェクトは、現在の所属の場合だけ（現在のマイルストンだけを）選択不可で表示する', () => {
    const done = project(P, 'P', '2026-11-05T00:00:00.000Z')
    const built = buildAssignmentOptions([done, project(Q, 'Q')], [m1, m2, mq], { projectId: P, milestoneId: m1.id })
    expect(built.groups.find((group) => group.options[0]?.value === `${P}:`)?.options.map((option) => [option.value, option.disabled])).toEqual([
      [`${P}:`, true],
      [`${P}:${m1.id}`, true]
    ])
    expect(built.unknown).toBeNull()
    expect(buildAssignmentOptions([done], [m1], { projectId: null, milestoneId: null }).groups).toEqual([])
  })

  it('同じ所属の判定はプロジェクトとマイルストンの両方', () => {
    expect(sameAssignment(task('t', m1.id), { projectId: P, milestoneId: m1.id })).toBe(true)
    expect(sameAssignment(task('t', m1.id), { projectId: P, milestoneId: null })).toBe(false)
  })
})
