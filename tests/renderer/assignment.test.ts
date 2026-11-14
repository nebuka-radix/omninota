import { describe, expect, it } from 'vitest'
import {
  buildAssignmentOptions,
  buildTaskGroups,
  groupKey,
  sameAssignment
} from '../../src/renderer/src/features/tasks/assignment'
import type { MilestoneDto } from '../../src/shared/contracts/milestones'
import type { ProjectDto } from '../../src/shared/contracts/projects'
import type { TaskDto } from '../../src/shared/contracts/tasks'

const P = 'aaaaaaaa-0000-4000-8000-000000000001'
const Q = 'bbbbbbbb-0000-4000-8000-000000000002'
const project = (id: string, name: string, doneOn: string | null = null): ProjectDto => ({
  favorite: false,
  id,
  name,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  done: doneOn !== null,
  doneOn
})
const milestone = (id: string, projectId: string, name: string, createdAt: string): MilestoneDto => ({
  id,
  projectId,
  name,
  createdAt,
  updatedAt: createdAt,
  done: false,
  doneOn: null,
  position: null
})
const task = (id: string, milestoneId: string | null, projectId: string | null = P): TaskDto => ({
  id,
  title: id,
  createdAt: '2026-11-10T00:00:00.000Z',
  updatedAt: '2026-11-10T00:00:00.000Z',
  doneOn: null,
  projectId,
  milestoneId,
  position: null,
  dueto: null, favorite: false
})

const m1 = milestone('11111111-0000-4000-8000-000000000001', P, 'M1', '2026-11-02T00:00:00.000Z')
const m2 = milestone('22222222-0000-4000-8000-000000000002', P, 'M2', '2026-11-01T00:00:00.000Z')
const mSame = milestone('33333333-0000-4000-8000-000000000003', P, 'M1', '2026-11-03T00:00:00.000Z')
const mq = milestone('44444444-0000-4000-8000-000000000004', Q, 'MQ', '2026-11-01T00:00:00.000Z')

describe('マイルストン別のグループ', () => {
  it('マイルストンは作成順。空のグループも残す。タスクの並びは渡した順（ソート済み）。「マイルストン未設定」のグループはない（フェーズ5.6）', () => {
    const groups = buildTaskGroups([task('t1', m1.id), task('t3', m1.id)], [m1, m2])
    expect(groups.map((group) => [group.key, group.label, group.tasks.map((t) => t.id)])).toEqual([
      [groupKey(m2.id), 'M2', []],
      [groupKey(m1.id), 'M1', ['t1', 't3']]
    ])
  })

  it('マイルストン0件ならグループ（カード）も0件', () => {
    expect(buildTaskGroups([], [])).toEqual([])
  })

  it('同名のマイルストンは判別できるラベルにする。一覧にないマイルストンのタスクはどのグループにも入れない', () => {
    const groups = buildTaskGroups([task('t1', 'missing-milestone'), task('t2', null)], [m1, mSame])
    const labels = groups.map((group) => group.label)
    expect(labels[0]).not.toBe(labels[1])
    expect(labels.every((label) => label.startsWith('M1（'))).toBe(true)
    expect(groups.flatMap((group) => group.tasks)).toEqual([])
  })
})

describe('カードのキー', () => {
  it('カードのキーは "group:<マイルストンID>" で、タスクID（UUID）と衝突せず、互いに重複しない', () => {
    const groups = buildTaskGroups([task('t1', m1.id), task('t2', mSame.id)], [m1, m2, mSame])
    const keys = groups.map((group) => group.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.every((key) => key.startsWith('group:'))).toBe(true)
    // 各タスクはちょうど1枚のカードに入る（カード間で同じタスクの行が重ならない）
    const placed = groups.flatMap((group) => group.tasks.map((t) => t.id))
    expect(placed.sort()).toEqual(['t1', 't2'])
  })
})

describe('詳細パネルの選択肢（マイルストンを含む）', () => {
  it('プロジェクトごとにマイルストン（作成順）だけを並べる（プロジェクトだけの選択肢はない）。他プロジェクトのマイルストンは混ぜない', () => {
    const built = buildAssignmentOptions([project(P, 'P'), project(Q, 'Q')], [m1, m2, mq], { projectId: null, milestoneId: null })
    expect(built.groups.map((group) => group.options.map((option) => option.value))).toEqual([
      [`${P}:${m2.id}`, `${P}:${m1.id}`],
      [`${Q}:${mq.id}`]
    ])
    expect(built.groups.flatMap((group) => group.options).every((option) => !option.disabled)).toBe(true)
  })

  it('マイルストンが0件のプロジェクトは、選べない選択肢で理由を示す（所属の値とは重ならない）', () => {
    const built = buildAssignmentOptions([project(P, 'P'), project(Q, 'Q')], [mq], { projectId: null, milestoneId: null })
    const pGroup = built.groups.find((group) => group.label === 'P')
    expect(pGroup?.options).toHaveLength(1)
    expect(pGroup?.options[0]).toMatchObject({ disabled: true })
    expect(pGroup?.options[0]?.label).toContain('マイルストンがありません')
    expect(pGroup?.options[0]?.value.startsWith(`${P}:`)).toBe(false)
  })

  it('完了済みプロジェクトは、現在の所属の場合だけ（現在のマイルストンだけを）選択不可で表示する', () => {
    const done = project(P, 'P', '2026-11-05T00:00:00.000Z')
    const built = buildAssignmentOptions([done, project(Q, 'Q')], [m1, m2, mq], { projectId: P, milestoneId: m1.id })
    expect(built.groups.find((group) => group.options[0]?.value.startsWith(`${P}:`))?.options.map((option) => [option.value, option.disabled])).toEqual([
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
