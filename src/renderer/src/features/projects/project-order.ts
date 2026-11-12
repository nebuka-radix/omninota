// プロジェクト一覧の表示順（Reactに依存しない純粋な関数。ホストNode.jsのテストで検証する）。
// 1. 未完了 → 完了
// 2. 各区分は日本語の名前順（数字は数値として比較、大文字・小文字は区別しない）
// 3. 同名なら作成日時の古い順、さらにIDの昇順（常に同じ順序にする）
import type { ProjectDto } from '../../../../shared/contracts/projects'

const nameCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

export function compareProjects(a: ProjectDto, b: ProjectDto): number {
  const aCompleted = a.done
  const bCompleted = b.done
  if (aCompleted !== bCompleted) return aCompleted ? 1 : -1
  const byName = nameCollator.compare(a.name, b.name)
  if (byName !== 0) return byName
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortProjects(projects: readonly ProjectDto[]): ProjectDto[] {
  return [...projects].sort(compareProjects)
}

// サイドバーの区分（フェーズ5.3）。各区分の中は compareProjects と同じ名前順・タイブレーカー
export function groupProjects(projects: readonly ProjectDto[]): { open: ProjectDto[]; completed: ProjectDto[] } {
  const sorted = sortProjects(projects)
  return {
    open: sorted.filter((project) => !project.done),
    completed: sorted.filter((project) => project.done)
  }
}
