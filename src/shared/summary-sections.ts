import type { SummaryItem, SummaryReview } from './contracts/summary'
import { summaryRanges } from './date-only'

// Summary Review の振り分け（Main の取得と、Renderer の保存直後の再判定で共通に使う。副作用なし）。
// - 対象: 未完了・期限あり・期限が7日後まで（削除由来の非表示は呼び出し側で除く。Main は SQL、Renderer は一覧キャッシュにないもの）
// - Today: 今日 / Tomorrow: 明日 / This Week: 明後日〜7日後（両端を含む）/ Overdue: 今日より前（昨日以前すべて）
// - 1つのタスクは1つの区画だけ（期限は1つ）。期限なし・8日後以降はどこにも入れない
// - 各セクション: 期限 → 作成日時 → ID の昇順
// 所属（プロジェクト・マイルストン）は判定に使わない（所属の変更だけでは対象から外れない）
export function splitSummary(items: readonly SummaryItem[], today: string): SummaryReview {
  const ranges = summaryRanges(today)
  const sorted = [...items].sort(
    (a, b) => compare(a.dueto, b.dueto) || compare(a.createdAt, b.createdAt) || compare(a.id, b.id)
  )
  const result: SummaryReview = { today, todayItems: [], tomorrowItems: [], thisWeekItems: [], overdueItems: [] }
  for (const item of sorted) {
    if (item.doneOn !== null) continue
    if (item.dueto < ranges.today) result.overdueItems.push(item)
    else if (item.dueto === ranges.today) result.todayItems.push(item)
    else if (item.dueto === ranges.tomorrow) result.tomorrowItems.push(item)
    else if (item.dueto >= ranges.weekStart && item.dueto <= ranges.weekEnd) result.thisWeekItems.push(item)
  }
  return result
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
