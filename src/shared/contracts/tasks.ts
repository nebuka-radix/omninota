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

// 一括操作で一度に扱えるタスク数の上限（フェーズ5.9）。入力検証（Main）で使う
export const TASK_BULK_MAX = 10000

// Inboxの複数タスクを、1つのマイルストンへまとめて紐付ける（フェーズ5.9）。
// Main が1つのトランザクションで検証・更新する。1件でも条件を満たさなければ、何も変更しない。
// 対象は表示中で、現在Inbox（未所属）のタスクだけ。移動先は未完了のプロジェクトとそのマイルストン。
// ids の順序で、移動先の手動順（ある場合）の末尾へ追加する
export type AssignInboxTasksInput = {
  ids: string[]
  projectId: string
  milestoneId: string
}

// 表示中の複数タスクの物理削除（フェーズ5.9）。1件でも削除できなければ、何も削除しない
export type DeleteTasksInput = {
  ids: string[]
}

export type DeleteTasksResult = {
  ids: string[]
}

// マイルストン内のタスクの手動順の保存（フェーズ5.9）。orderedIds はそのマイルストンの表示中のタスク全件
// （完了済みを含む）を、新しい順序で並べたもの。DBの所属タスクと一致しなければ、何も変更しない（CONFLICT）
export type ReorderMilestoneTasksInput = {
  milestoneId: string
  orderedIds: string[]
}

// 日時はUTCのISO 8601文字列（例: 2026-11-09T10:00:00.000Z）
// 一覧・更新の対象は表示中のタスクだけ（削除由来の非表示タスクはAPIから返さない。フェーズ5.6）
// doneOn: 未完了ならnull。完了状態はdoneOnだけから導出する。
export type TaskDto = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  doneOn: string | null
  // 所属するプロジェクトのID。nullは未所属（フェーズ5.2）
  projectId: string | null
  // 所属するマイルストンのID（フェーズ5.4）。表示中のタスクでは、projectId があれば必ずあり、projectId が null なら null
  milestoneId: string | null
  // マイルストン内の手動順（フェーズ5.9。小さいほど上）。null は手動順がない（作成日時の古い順で表示する）。
  // 同じマイルストンの表示中のタスクは、全件に値があるか、全件 null のどちらか（Mainが保つ）
  position: number | null
  // 期限（フェーズ6）。日付のみ "YYYY-MM-DD"（時刻・タイムゾーンなし）。null は未設定
  dueto: string | null
  // お気に入り（0009で追加）。未設定はなく、既定は false
  favorite: boolean
}

// 期限の設定・変更・解除（フェーズ6）。「今日」「明日」は Main が操作の時点のローカルの暦日で決める
// （画面を開いたまま日付が変わっても、古い日付を保存しない）。date は実在する暦日（Mainで検証）。過去の日付も可
export type TaskDueChange = { kind: 'today' } | { kind: 'tomorrow' } | { kind: 'date'; date: string } | { kind: 'clear' }

export type SetTasksDayInput = { ids: string[]; day: 'today' | 'tomorrow' }

export type SetTaskDueInput = {
  id: string
  due: TaskDueChange
}

// お気に入りの設定・解除（TaskRow の星）。トグルではなく目的の状態を指定する（連打・再試行で反転しないようにする）。
// お気に入りだけを更新し、同じ値なら変更しない（updatedAt も変えない）
export type SetTaskFavoriteInput = {
  id: string
  favorite: boolean
}

export function isTaskCompleted(task: Pick<TaskDto, 'doneOn'>): boolean {
  return task.doneOn !== null
}
