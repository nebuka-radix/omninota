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

// 完了・完了の取り消し（フェーズ5.3）。目的の状態を指定する（トグルではない）。
export type SetProjectFavoriteInput = { id: string; favorite: boolean }

export type SetProjectCompletedInput = {
  id: string
  completed: boolean
}

// 日時はUTCのISO 8601文字列。done: 完了状態（0010。永続化した列）。doneOn: 完了日時（未完了なら null）。
// done = true なら doneOn あり、false なら null（完了・取り消しはフェーズ5.3の projects.setCompleted）
export type ProjectDto = {
  favorite: boolean
  id: string
  name: string
  createdAt: string
  updatedAt: string
  done: boolean
  doneOn: string | null
}

// 削除の確認内容（フェーズ5.6）。件数はDBで数える。taskCount は既に非表示のタスク（マイルストンの削除で非表示になったもの）を含む総数
export type ProjectDeletionSummary = {
  id: string
  name: string
  done: boolean
  doneOn: string | null
  milestoneCount: number
  taskCount: number
  hiddenTaskCount: number
}

// 削除（フェーズ5.6）。確認した時の件数を渡す。DBの件数と違えば削除せず CONFLICT（deletion-scope-changed）
export type DeleteProjectInput = {
  id: string
  expectedMilestoneCount: number
  expectedTaskCount: number
}

// 配下のマイルストン・タスクは削除せず、所属を外して非表示にする
export type DeleteProjectResult = {
  id: string
  milestoneCount: number
  taskCount: number
}
