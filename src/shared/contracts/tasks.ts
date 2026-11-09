// タスクのIPC契約。型と定数だけを置き、実行時依存を持たない。

// タイトルの最大文字数（前後の空白を除いた後、JavaScriptの文字列長で数える）。
// Mainの入力検証とRendererの入力欄で共通に使う。
export const TASK_TITLE_MAX_LENGTH = 200

export type CreateTaskInput = {
  title: string
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

// 日時はUTCのISO 8601文字列（例: 2026-11-09T10:00:00.000Z）
// completedAt: 未完了ならnull。完了状態はcompletedAtだけから導出する。
export type TaskDto = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export function isTaskCompleted(task: Pick<TaskDto, 'completedAt'>): boolean {
  return task.completedAt !== null
}
