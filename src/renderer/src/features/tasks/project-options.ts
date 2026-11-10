// 詳細パネルの所属の選択肢（フェーズ5.2）。DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。
// - 「未所属」と、未完了のプロジェクトを選べる（完了済みへの移動はMain側でも拒否する）。
// - 同名のプロジェクトはIDで区別し、作成日時とIDの先頭8文字を補助情報として付ける。
// - 現在の所属が完了済みでも、現在値として正しく表示する（選択はできない）。空欄・「未所属」に見せない。
import type { ProjectDto } from '../../../../shared/contracts/projects'
import { sortProjects } from '../projects/project-order'

export const UNASSIGNED_VALUE = ''

export type ProjectOption = { value: string; label: string; disabled: boolean }

const createdFormat = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})

export function buildProjectOptions(projects: readonly ProjectDto[], currentProjectId: string | null): ProjectOption[] {
  const nameCounts = new Map<string, number>()
  for (const project of projects) nameCounts.set(project.name, (nameCounts.get(project.name) ?? 0) + 1)
  const label = (project: ProjectDto) => {
    const base =
      (nameCounts.get(project.name) ?? 0) > 1
        ? `${project.name}（${createdFormat.format(new Date(project.createdAt))} 作成・ID ${project.id.slice(0, 8)}）`
        : project.name
    return project.completedAt === null ? base : `${base}（完了済み）`
  }

  const options: ProjectOption[] = [{ value: UNASSIGNED_VALUE, label: '未所属（Inbox）', disabled: false }]
  for (const project of sortProjects([...projects])) {
    const isCurrent = project.id === currentProjectId
    // 完了済みは現在の所属の場合だけ表示する（選択不可）
    if (project.completedAt !== null && !isCurrent) continue
    options.push({ value: project.id, label: label(project), disabled: project.completedAt !== null })
  }
  if (currentProjectId !== null && !projects.some((project) => project.id === currentProjectId)) {
    // 一覧にない（取得のずれなど）。値を失わないよう、不明として表示する
    options.push({ value: currentProjectId, label: '不明なプロジェクト', disabled: true })
  }
  return options
}

export function toProjectIdValue(value: string): string | null {
  return value === UNASSIGNED_VALUE ? null : value
}
