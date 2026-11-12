// タスクの所属（プロジェクト・マイルストン）に関する表示用の計算（フェーズ5.4。5.2の project-options.ts を統合）。
// DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。業務ルールの保証はMain側で行う。
import type { MilestoneDto } from '../../../../shared/contracts/milestones'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { sortProjects } from '../projects/project-order'

export type Assignment = { projectId: string | null; milestoneId: string | null }

// 詳細パネルの select の値（未所属 = 空文字、マイルストン = "<projectId>:<milestoneId>"）。
// フェーズ5.6でプロジェクトだけの所属は廃止した（選択肢に出さない。Mainでも拒否する）
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

// 手動順（position）→ 作成日時の古い順 → IDの昇順で比べる（フェーズ5.9。Mainの一覧と同じ規則）。
// position が null（手動順なし）は後ろ。同じ範囲（プロジェクト・マイルストン）では、全件に値があるか全件 null のどちらか
export function compareManualOrder(
  a: { position: number | null; createdAt: string; id: string },
  b: { position: number | null; createdAt: string; id: string }
): number {
  if (a.position !== b.position) {
    if (a.position === null) return 1
    if (b.position === null) return -1
    return a.position - b.position
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

// マイルストンの表示順（手動順 → 作成日時・IDの昇順。Mainの一覧と同じ。フェーズ5.9で手動順を追加）
export function sortMilestones(milestones: readonly MilestoneDto[]): MilestoneDto[] {
  return [...milestones].sort(compareManualOrder)
}

export function milestonesOf(milestones: readonly MilestoneDto[], projectId: string): MilestoneDto[] {
  return sortMilestones(milestones.filter((milestone) => milestone.projectId === projectId))
}

export type AssignmentOption = { value: string; label: string; disabled: boolean }

// マイルストンが0件のプロジェクトを示す、選べない選択肢の値（所属の値とは重ならない）
const NO_MILESTONE_VALUE_PREFIX = 'no-milestone:'
export type AssignmentOptionGroup = { label: string; options: AssignmentOption[] }

// 詳細パネルの所属の選択肢。1つの select で「未所属」か「マイルストン」を選び、1回で保存する。
// - 未完了のプロジェクトのマイルストンを選べる。完了済みのプロジェクトは、現在の所属の場合だけ表示する（選択不可）。
// - マイルストンが0件のプロジェクトは選べない（理由を無効な選択肢で示す。フェーズ5.6）。
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
    const completed = project.done
    const isCurrent = project.id === current.projectId
    if (completed && !isCurrent) continue
    const name = `${projectLabels.get(project.id) ?? project.name}${completed ? '（完了済み）' : ''}`
    const own = milestonesOf(milestones, project.id)
    const milestoneLabels = disambiguatedNames(own)
    const options: AssignmentOption[] = []
    for (const milestone of own) {
      if (completed && milestone.id !== current.milestoneId) continue
      options.push({
        value: assignmentValue({ projectId: project.id, milestoneId: milestone.id }),
        label: `${name} › ${milestoneLabels.get(milestone.id) ?? milestone.name}`,
        disabled: completed
      })
    }
    if (options.length === 0) {
      options.push({ value: `${NO_MILESTONE_VALUE_PREFIX}${project.id}`, label: `${name} — マイルストンがありません（プロジェクト画面で作成）`, disabled: true })
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

// プロジェクト画面のグループ（マイルストン別。マイルストンは手動順 → 作成順）。
// tasks は表示中のタスク（検索・状態・ソート済み）。空のマイルストンも表示する。
// フェーズ5.5から、グループ1つをカード1枚として表示する（カードごとに別の仮想リスト。key はカードの安定したID）。
// フェーズ5.6で「マイルストン未設定」のグループは廃止した（表示中のプロジェクトのタスクは必ずマイルストンに所属する）。
// 一覧にないマイルストンのタスク（取得のずれの間だけ起こり得る）は、どのカードにも入れない（次の取得で揃う）。
export type TaskGroup = {
  key: string
  milestoneId: string
  label: string
  tasks: TaskDto[]
}

export const groupKey = (milestoneId: string) => `group:${milestoneId}`

export function buildTaskGroups(tasks: readonly TaskDto[], milestones: readonly MilestoneDto[]): TaskGroup[] {
  const labels = disambiguatedNames(milestones)
  const groups: TaskGroup[] = sortMilestones(milestones).map((milestone) => ({
    key: groupKey(milestone.id),
    milestoneId: milestone.id,
    label: labels.get(milestone.id) ?? milestone.name,
    tasks: []
  }))
  const byId = new Map(groups.map((group) => [group.milestoneId, group]))
  for (const task of tasks) {
    if (task.milestoneId !== null) byId.get(task.milestoneId)?.tasks.push(task)
  }
  return groups
}
