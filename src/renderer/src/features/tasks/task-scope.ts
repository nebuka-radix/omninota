// タスク一覧の表示範囲（フェーズ5.2）。DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。
// - inbox: プロジェクトに属さないタスク（初期版の暫定定義。「未整理」と同じ意味とは扱わない）
// - project: 指定したプロジェクトに属するタスク
import type { TaskDto } from '../../../../shared/contracts/tasks'

export type TaskScope = { kind: 'inbox' } | { kind: 'project'; projectId: string }

export const INBOX_SCOPE: TaskScope = { kind: 'inbox' }

// 表示範囲の識別子（選択の引き継ぎ判定や、Reactのkeyに使う）
export function taskScopeKey(scope: TaskScope): string {
  return scope.kind === 'inbox' ? 'inbox' : `project:${scope.projectId}`
}

// この範囲で作成するタスクの所属先（Inboxは未所属）
export function scopeProjectId(scope: TaskScope): string | null {
  return scope.kind === 'inbox' ? null : scope.projectId
}

export function isTaskInScope(task: Pick<TaskDto, 'projectId'>, scope: TaskScope): boolean {
  return task.projectId === scopeProjectId(scope)
}
