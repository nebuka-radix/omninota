// プロジェクトのIPC契約。型と定数だけを置き、実行時依存を持たない。

// プロジェクト名の最大文字数（前後の空白を除いた後、JavaScriptの文字列長で数える）。
// タスクのタイトル（TASK_TITLE_MAX_LENGTH）とは別の定数とし、一方の変更が他方へ波及しないようにする。
// Mainの入力検証とRendererの入力欄で共通に使う。
export const PROJECT_NAME_MAX_LENGTH = 200

export type CreateProjectInput = {
  name: string
}

export type RenameProjectInput = {
  id: string
  name: string
}

// 日時はUTCのISO 8601文字列。completedAt: 未完了ならnull（フェーズ5.1では常にnull。完了操作は5.3）
export type ProjectDto = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  completedAt: string | null
}
