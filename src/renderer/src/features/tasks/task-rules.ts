// タスク一覧・詳細の表示上の規則（フェーズ5.3）。DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。
// 業務ルールの保証はMain側で行う。ここでの判定は、操作できない理由を先に示すためだけに使う。
import type { ProjectDto } from '../../../../shared/contracts/projects'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { isTaskInScope, type TaskScope } from './task-scope'
import type { TaskStatusFilter } from './task-table'

export const REOPEN_BLOCKED_REASON =
  '完了済みのプロジェクトのタスクは未完了に戻せません。先にプロジェクトを未完了に戻してください。'

// プロジェクトの画面を開いた時（切り替えた時）の状態フィルター。
// 未完了のプロジェクトは「未完了」、完了済みのプロジェクトは「完了」を初期表示にする。
// 同じ画面のまま完了・取り消しをしても、表示中のフィルターは変えない（突然一覧が空にならないように）。
export function initialStatusForProject(project: Pick<ProjectDto, 'done'>): TaskStatusFilter {
  return !project.done ? 'open' : 'completed'
}

// 完了済みのタスクを未完了に戻せない理由（所属プロジェクトが完了済み）。戻せる場合はnull
export function reopenBlockedReason(
  task: Pick<TaskDto, 'doneOn' | 'projectId'>,
  projects: readonly Pick<ProjectDto, 'id' | 'done'>[] | undefined
): string | null {
  if (task.doneOn === null || task.projectId === null || !projects) return null
  const project = projects.find((item) => item.id === task.projectId)
  return project && project.done ? REOPEN_BLOCKED_REASON : null
}

// 検索欄と同じ一致規則（大文字・小文字を区別しない部分一致。Tableの includesString と同じ考え方）
export function matchesTitleSearch(title: string, search: string): boolean {
  const query = search.trim().toLowerCase()
  return query === '' || title.toLowerCase().includes(query)
}

// 「未完了のタスクを表示」: 範囲内の未完了タスクのうち1件でも検索で隠れるなら、検索をクリアする
export function shouldClearSearchToRevealOpen(
  tasks: readonly Pick<TaskDto, 'title' | 'doneOn' | 'projectId'>[],
  scope: TaskScope,
  search: string
): boolean {
  if (search.trim() === '') return false
  return tasks.some((task) => isTaskInScope(task, scope) && task.doneOn === null && !matchesTitleSearch(task.title, search))
}
