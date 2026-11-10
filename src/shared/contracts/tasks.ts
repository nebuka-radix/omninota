// タスクのIPC契約。型と定数だけを置き、実行時依存を持たない。

// タイトルの最大文字数（前後の空白を除いた後、JavaScriptの文字列長で数える）。
// Mainの入力検証とRendererの入力欄で共通に使う。
export const TASK_TITLE_MAX_LENGTH = 200

// 所属の指定（フェーズ5.6から）: Inbox（projectId・milestoneId ともに省略／null）か、
// プロジェクトとそのプロジェクトのマイルストンの両方を指定する。プロジェクトだけ・マイルストンだけの指定は拒否する。
export type CreateTaskInput = {
  title: string
  projectId?: string | null
  milestoneId?: string | null
}

export type UpdateTaskTitleInput = {
  id: string
  title: string
}

// 完了状態は「目的の状態」を指定する（トグルではない）。
// 二重呼び出し・再試行で状態が意図せず反転しないようにするため。
export type SetTaskCompletedInput = {
  id: string
  completed: boolean
}

// 所属（プロジェクト・マイルストン）の変更・解除を1回で保存する（フェーズ5.4。5.2の setProject を置き換え）。
// - 未所属（Inbox）: projectId = null, milestoneId = null
// - マイルストン: 両方あり（そのプロジェクトのマイルストン）
// - プロジェクトだけ（milestoneId = null）はフェーズ5.6で廃止（INVALID_INPUT）
// 目的の状態を指定する（同じなら変更しない）。
export type SetTaskAssignmentInput = {
  id: string
  projectId: string | null
  milestoneId: string | null
}

// タスクの削除（フェーズ5.6）。表示中のタスクを物理削除する
export type DeleteTaskInput = {
  id: string
}

export type DeleteTaskResult = {
  id: string
}

// 日時はUTCのISO 8601文字列（例: 2026-11-09T10:00:00.000Z）
// 一覧・更新の対象は表示中のタスクだけ（削除由来の非表示タスクはAPIから返さない。フェーズ5.6）
// completedAt: 未完了ならnull。完了状態はcompletedAtだけから導出する。
export type TaskDto = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
  // 所属するプロジェクトのID。nullは未所属（フェーズ5.2）
  projectId: string | null
  // 所属するマイルストンのID（フェーズ5.4）。表示中のタスクでは、projectId があれば必ずあり、projectId が null なら null
  milestoneId: string | null
}

export function isTaskCompleted(task: Pick<TaskDto, 'completedAt'>): boolean {
  return task.completedAt !== null
}
