// タスクのIPC契約。型と定数だけを置き、実行時依存を持たない。

// タイトルの最大文字数（前後の空白を除いた後、JavaScriptの文字列長で数える）。
// Mainの入力検証とRendererの入力欄で共通に使う。
export const TASK_TITLE_MAX_LENGTH = 200

// projectId: 作成するタスクの所属先（フェーズ5.2）。省略・nullなら未所属（Inbox）。
// milestoneId: 所属するマイルストン（フェーズ5.4。任意）。指定する場合は projectId も必要で、そのプロジェクトのマイルストンであること。
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
// - 未所属: projectId = null, milestoneId = null
// - プロジェクトだけ: projectId あり, milestoneId = null（マイルストン未設定）
// - マイルストン: 両方あり（そのプロジェクトのマイルストン）
// 目的の状態を指定する（同じなら変更しない）。
export type SetTaskAssignmentInput = {
  id: string
  projectId: string | null
  milestoneId: string | null
}

// 日時はUTCのISO 8601文字列（例: 2026-11-09T10:00:00.000Z）
// completedAt: 未完了ならnull。完了状態はcompletedAtだけから導出する。
export type TaskDto = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
  // 所属するプロジェクトのID。nullは未所属（フェーズ5.2）
  projectId: string | null
  // 所属するマイルストンのID。nullはマイルストン未設定（フェーズ5.4）。projectId が null なら常に null
  milestoneId: string | null
}

export function isTaskCompleted(task: Pick<TaskDto, 'completedAt'>): boolean {
  return task.completedAt !== null
}
