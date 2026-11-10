// タスクの所属（プロジェクト・マイルストン）に関する表示用の計算（フェーズ5.4。5.2の project-options.ts を統合）。
// DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。業務ルールの保証はMain側で行う。
import type { MilestoneDto } from '../../../../shared/contracts/milestones'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { sortProjects } from '../projects/project-order'

export type Assignment = { projectId: string | null; milestoneId: string | null }

// 詳細パネルの select の値（未所属 = 空文字、プロジェクトだけ = "<projectId>:"、マイルストン = "<projectId>:<milestoneId>"）
export const UNASSIGNED_VALUE = ''

export function assignmentValue(assignment: Assignment): string {
  return assignment.projectId === null ? UNASSIGNED_VALUE : `${assignment.projectId}:${assignment.milestoneId ?? ''}`
}

export function parseAssignmentValue(value: string): Assignment {
  if (value === UNASSIGNED_VALUE) return { projectId: null, milestoneId: null }
  const [projectId = '', milestoneId = ''] = value.split(':')
  return { projectId, milestoneId: milestoneId === '' ? null : milestoneId }
}

export function sameAssignment(task: Pick<TaskDto, 'projectId' | 'milestoneId'>, assignment: Assignment): boolean {
  return task.projectId === assignment.projectId && task.milestoneId === assignment.milestoneId
}

const createdFormat = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

// 同名があれば、作成日時とIDの先頭8文字を付けて区別する（プロジェクト・マイルストン共通）
export function disambiguatedNames<T extends { id: string; name: string; createdAt: string }>(items: readonly T[]): Map<string, string> {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
  const labels = new Map<string, string>()
  for (const item of items) {
    labels.set(
      item.id,
      (counts.get(item.name) ?? 0) > 1
        ? `${item.name}（${createdFormat.format(new Date(item.createdAt))} 作成・ID ${item.id.slice(0, 8)}）`
        : item.name
    )
  }
  return labels
}

// マイルストンの表示順（作成日時・IDの昇順。Mainの一覧と同じ）
export function sortMilestones(milestones: readonly MilestoneDto[]): MilestoneDto[] {
  return [...milestones].sort((a, b) =>
    a.createdAt !== b.createdAt ? (a.createdAt < b.createdAt ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  )
}

export function milestonesOf(milestones: readonly MilestoneDto[], projectId: string): MilestoneDto[] {
  return sortMilestones(milestones.filter((milestone) => milestone.projectId === projectId))
}

export type AssignmentOption = { value: string; label: string; disabled: boolean }
export type AssignmentOptionGroup = { label: string; options: AssignmentOption[] }

// 詳細パネルの所属の選択肢。1つの select で「未所属」「プロジェクトだけ」「マイルストン」を選び、1回で保存する。
// - 未完了のプロジェクトとそのマイルストンを選べる。完了済みのプロジェクトは、現在の所属の場合だけ表示する（選択不可）。
// - 同名のプロジェクト・マイルストンは作成日時とIDの先頭で区別する。
// - 現在値が一覧にない（取得のずれなど）場合も、値を失わないよう「不明」として表示する。
export function buildAssignmentOptions(
  projects: readonly ProjectDto[],
  milestones: readonly MilestoneDto[],
  current: Assignment
): { unassigned: AssignmentOption; groups: AssignmentOptionGroup[]; unknown: AssignmentOption | null } {
  const projectLabels = disambiguatedNames(projects)
  const groups: AssignmentOptionGroup[] = []
  for (const project of sortProjects(projects)) {
    const completed = project.completedAt !== null
    const isCurrent = project.id === current.projectId
    if (completed && !isCurrent) continue
    const name = `${projectLabels.get(project.id) ?? project.name}${completed ? '（完了済み）' : ''}`
    const own = milestonesOf(milestones, project.id)
    const milestoneLabels = disambiguatedNames(own)
    const options: AssignmentOption[] = [
      { value: assignmentValue({ projectId: project.id, milestoneId: null }), label: `${name} — マイルストン未設定`, disabled: completed }
    ]
    for (const milestone of own) {
      if (completed && milestone.id !== current.milestoneId) continue
      options.push({
        value: assignmentValue({ projectId: project.id, milestoneId: milestone.id }),
        label: `${name} › ${milestoneLabels.get(milestone.id) ?? milestone.name}`,
        disabled: completed
      })
    }
    groups.push({ label: name, options })
  }
  const currentValue = assignmentValue(current)
  const known =
    currentValue === UNASSIGNED_VALUE || groups.some((group) => group.options.some((option) => option.value === currentValue))
  return {
    unassigned: { value: UNASSIGNED_VALUE, label: '未所属（Inbox）', disabled: false },
    groups,
    unknown: known ? null : { value: currentValue, label: '不明なプロジェクト・マイルストン', disabled: true }
  }
}

// プロジェクト画面のグループ（マイルストン別。マイルストンは作成順、最後に「マイルストン未設定」）。
// tasks は表示中のタスク（検索・状態・ソート済み）。空のマイルストンも表示する。
// フェーズ5.5から、グループ1つをカード1枚として表示する（カードごとに別の仮想リスト。key はカードの安定したID）。
export type TaskGroup = {
  key: string
  milestoneId: string | null
  label: string
  tasks: TaskDto[]
}

export const UNSET_GROUP_KEY = 'group:unset'
export const groupKey = (milestoneId: string | null) => (milestoneId === null ? UNSET_GROUP_KEY : `group:${milestoneId}`)

export function buildTaskGroups(tasks: readonly TaskDto[], milestones: readonly MilestoneDto[]): TaskGroup[] {
  const labels = disambiguatedNames(milestones)
  const groups: TaskGroup[] = sortMilestones(milestones).map((milestone) => ({
    key: groupKey(milestone.id),
    milestoneId: milestone.id,
    label: labels.get(milestone.id) ?? milestone.name,
    tasks: []
  }))
  const unset: TaskGroup = { key: UNSET_GROUP_KEY, milestoneId: null, label: 'マイルストン未設定', tasks: [] }
  const byId = new Map(groups.map((group) => [group.milestoneId, group]))
  for (const task of tasks) {
    // 一覧にないマイルストン（取得のずれ）のタスクも失わないよう「未設定」に表示する
    const group = (task.milestoneId !== null && byId.get(task.milestoneId)) || unset
    group.tasks.push(task)
  }
  return [...groups, unset]
}
