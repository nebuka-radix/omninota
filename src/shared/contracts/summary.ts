// Summary Review（フェーズ6）の契約。型だけを置き、実行時依存を持たない。
// 対象は tasks（未完了・表示中・期限あり）。期間は Main が操作の時点のローカルの暦日で決める。
import type { TaskDto } from './tasks'

// 各行は通常のタスク（TaskRow で表示・操作する）と、所属の名前（読み上げ・ツールチップ用）
export type SummaryItem = TaskDto & {
  // 期限（"YYYY-MM-DD"。Summary の対象は期限ありだけ）
  dueto: string
  projectName: string | null
  milestoneName: string | null
}

export type SummaryReview = {
  // 判定に使ったローカルの「今日」（"YYYY-MM-DD"）。画面はこの日付と自分の日付を比べ、古い結果を使わない
  today: string
  // 各セクション（期限の昇順 → 作成日時の昇順 → IDの昇順）
  todayItems: SummaryItem[]
  tomorrowItems: SummaryItem[]
  // 明後日〜7日後（両端を含む。暦週ではない）
  thisWeekItems: SummaryItem[]
  // 期限超過（期限が今日より前。過去の日数の制限なし。期限 → 作成日時 → ID の昇順）
  overdueItems: SummaryItem[]
}
