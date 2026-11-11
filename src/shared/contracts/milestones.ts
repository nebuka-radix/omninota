// マイルストンのIPC契約（フェーズ5.4）。型と定数だけを置き、実行時依存を持たない。

// マイルストン名の最大文字数（前後の空白を除いた後の文字列長）。プロジェクト名・タスク名とは別の定数。
export const MILESTONE_NAME_MAX_LENGTH = 200

// 新規プロジェクトの作成時に、同じトランザクションで作るマイルストンの名前（フェーズ5.6）。通常のマイルストンと同じく名前変更・削除できる
export const INITIAL_MILESTONE_NAME = '新しいマイルストン'

export type CreateMilestoneInput = {
  projectId: string
  name: string
}

export type RenameMilestoneInput = {
  id: string
  name: string
}

// 削除の確認内容（フェーズ5.6）。taskCount はDBで数えた所属タスクの総数（完了済み・検索で隠れているものを含む）
export type MilestoneDeletionSummary = {
  id: string
  name: string
  taskCount: number
}

// 削除（フェーズ5.6）。expectedTaskCount は確認した時の件数。DBの件数と違えば削除せず CONFLICT（deletion-scope-changed）
export type DeleteMilestoneInput = {
  id: string
  expectedTaskCount: number
}

// hiddenTaskCount: 所属を外して非表示にしたタスクの件数（タスク自体は削除しない）
export type DeleteMilestoneResult = {
  id: string
  hiddenTaskCount: number
}

// 日時はUTCのISO 8601文字列。一覧・操作の対象は表示中（プロジェクトに所属する）のマイルストンだけ（フェーズ5.6）
export type MilestoneDto = {
  id: string
  projectId: string
  name: string
  createdAt: string
  updatedAt: string
  // プロジェクト内のカードの手動順（フェーズ5.9。小さいほど先）。null は手動順がない（作成日時の古い順）。
  // 同じプロジェクトの表示中のマイルストンは、全件に値があるか、全件 null のどちらか（Mainが保つ）
  position: number | null
}

// カード（マイルストン）の順序の保存（フェーズ5.9）。orderedIds はそのプロジェクトの表示中のマイルストン全件を新しい順序で並べたもの。
// DBと一致しなければ、何も変更しない（CONFLICT）
export type ReorderMilestonesInput = {
  projectId: string
  orderedIds: string[]
}
