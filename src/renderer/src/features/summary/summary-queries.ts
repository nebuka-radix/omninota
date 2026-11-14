import { queryOptions } from '@tanstack/react-query'
import { unwrapIpc } from '../../lib/ipc'

// Summary Review（フェーズ6）。条件（未完了・表示中・期限が今日〜7日後）は Main で適用し、該当分だけを取得する。
// キーにローカルの日付を含め、日付が変わった後に前日の結果を表示・上書きしない（前日の結果は別のキャッシュに残るだけ）。
export const summaryKeys = {
  all: ['summary'] as const,
  day: (day: string) => [...summaryKeys.all, day] as const
}

export const summaryQueryOptions = (day: string) =>
  queryOptions({
    queryKey: summaryKeys.day(day),
    queryFn: () => unwrapIpc(window.gtd.summary.get()),
    // 画面へ戻った時は必ず取り直す（他の画面での期限・完了・削除などの変更を反映する）
    refetchOnMount: 'always'
  })
