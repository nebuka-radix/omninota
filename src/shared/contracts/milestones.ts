// マイルストンのIPC契約（フェーズ5.4）。型と定数だけを置き、実行時依存を持たない。

// マイルストン名の最大文字数（前後の空白を除いた後の文字列長）。プロジェクト名・タスク名とは別の定数。
export const MILESTONE_NAME_MAX_LENGTH = 200

export type CreateMilestoneInput = {
  projectId: string
  name: string
}

export type RenameMilestoneInput = {
  id: string
  name: string
}

// 日時はUTCのISO 8601文字列
export type MilestoneDto = {
  id: string
  projectId: string
  name: string
  createdAt: string
  updatedAt: string
}
