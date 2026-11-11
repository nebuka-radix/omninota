import type { SummaryItem, SummaryReview } from '../../shared/contracts/summary'
import { localDateOnly, summaryRanges } from '../../shared/date-only'
import { splitSummary } from '../../shared/summary-sections'
import type { DueTaskRow } from '../repositories/task-repository'
import { toTaskDto } from './task-service'

// Summary Review（フェーズ6）。対象は tasks（未完了・表示中・期限あり。通常のInboxタスクも含む）。
// 期間は取得の時点（now）のローカルの暦日で決め、保存済みの "YYYY-MM-DD" と文字列で比べる（UTC日時へ変換しない）。
// - Today: 今日 / Tomorrow: 明日 / This Week: 明後日〜7日後（両端を含む。暦週ではない）
// - 昨日以前・8日後以降・期限なし・完了済み・削除由来の非表示は含めない
// 条件は SQL（Repository）で適用し、該当するタスクだけを返す（全件を Renderer へ送らない）。
// 各行は通常のタスクDTO（TaskRow で表示・操作するため）と所属の名前。
export type SummaryService = {
  get(): SummaryReview
  // 現在のローカルの暦日（"YYYY-MM-DD"）。画面の期限表示（Today・Tomorrow・{N}Days）を、保存・Summary の判定と同じ日付にする
  today(): string
}

function toItem(row: DueTaskRow): SummaryItem {
  return { ...toTaskDto(row), dueto: row.dueto, projectName: row.projectName, milestoneName: row.milestoneName }
}

export function createSummaryService(deps: {
  listDueBetween: (from: string, to: string) => DueTaskRow[]
  now?: () => Date
}): SummaryService {
  const now = deps.now ?? (() => new Date())
  return {
    today: () => localDateOnly(now()),
    get() {
      const today = localDateOnly(now())
      const ranges = summaryRanges(today)
      // 今日〜7日後をまとめて取得し（期限・作成日時・IDの順）、期限で振り分ける
      return splitSummary(deps.listDueBetween(ranges.today, ranges.weekEnd).map(toItem), today)
    }
  }
}
