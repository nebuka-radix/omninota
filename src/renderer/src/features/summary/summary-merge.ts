import type { SummaryItem, SummaryReview } from '../../../../shared/contracts/summary'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { splitSummary } from '../../../../shared/summary-sections'

// Main の取得結果に、一覧の Query（保存成功の応答で更新される正本のキャッシュ）の新しい方の値を重ねて、
// Main と同じ規則（splitSummary）で振り分け直す。保存に成功した直後から（Summary の取り直しを待たずに）、
// 完了したタスクは対象から外れ、期限を変えたタスクは所属のセクションが変わる。所属（プロジェクト）の変更だけでは外れない。
// 一覧の Query にないタスク（削除・非表示）は外す（一覧の Query を取得済みの場合）。
export function mergeSummary(summary: SummaryReview, tasks: readonly TaskDto[] | undefined): SummaryReview {
  const byId = tasks ? new Map(tasks.map((task) => [task.id, task])) : null
  const items: SummaryItem[] = []
  for (const item of [...summary.todayItems, ...summary.tomorrowItems, ...summary.thisWeekItems, ...summary.overdueItems]) {
    const latest = byId?.get(item.id)
    if (byId && !latest) continue
    const task = latest && latest.updatedAt >= item.updatedAt ? latest : item
    if (task.dueto === null) continue
    items.push({ ...task, dueto: task.dueto, projectName: item.projectName, milestoneName: item.milestoneName })
  }
  return splitSummary(items, summary.today)
}

// 右サイドバーのプロジェクトのフィルター（表示だけ）。OFF のプロジェクトに所属するタスクを全区画から外す。
// プロジェクトに属さないタスク（Inbox）は外さない
export function filterSummaryByProjects(summary: SummaryReview, excluded: ReadonlySet<string>): SummaryReview {
  if (excluded.size === 0) return summary
  const keep = (item: SummaryItem) => item.projectId === null || !excluded.has(item.projectId)
  return {
    today: summary.today,
    todayItems: summary.todayItems.filter(keep),
    tomorrowItems: summary.tomorrowItems.filter(keep),
    thisWeekItems: summary.thisWeekItems.filter(keep),
    overdueItems: summary.overdueItems.filter(keep)
  }
}

// 4区画の合計件数（取得・フィルター後の対象の件数。描画した行数ではない）
export function summaryTotal(summary: SummaryReview): number {
  return summary.todayItems.length + summary.tomorrowItems.length + summary.thisWeekItems.length + summary.overdueItems.length
}
