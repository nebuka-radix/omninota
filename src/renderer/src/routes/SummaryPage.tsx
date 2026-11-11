import { useMemo, useState } from 'react'
import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck } from 'lucide-react'
import type { SummaryReview } from '../../../shared/contracts/summary'
import type { TaskDto } from '../../../shared/contracts/tasks'
import { Page } from '../components/Page'
import { ShellSlot } from '../components/ShellSlots'
import { mergeSummary } from '../features/summary/summary-merge'
import { summaryQueryOptions } from '../features/summary/summary-queries'
import { TaskList, TASK_ROW_HEIGHT } from '../features/tasks/TaskList'
import { taskListQueryOptions, usePendingTaskIds } from '../features/tasks/task-queries'
import { useTaskRowActions } from '../features/tasks/use-task-row-actions'
import { useLocalDay } from '../lib/local-day'
import { vscodeColors } from '../theme'

const HEADING_HEIGHT = 36
const EMPTY_HEIGHT = 30
const SECTIONS: { key: keyof Omit<SummaryReview, 'today'>; label: string }[] = [
  { key: 'todayItems', label: 'Actions for Today' },
  { key: 'tomorrowItems', label: 'Actions for Tomorrow' },
  { key: 'thisWeekItems', label: 'Actions for This Week' }
]
const EMPTY_TASKS: TaskDto[] = []

// Summary Review（フェーズ6）。未完了・期限ありのタスクを Today / Tomorrow / This Week（明後日〜7日後）に分けて表示する。
// - 条件は Main で適用し、該当分だけを取得する。判定の「今日」は Main が取得の時点のローカルの暦日で決める。
// - 各行は共通の TaskRow（Inbox・プロジェクトのカードと同じ表示・操作）。セクションごとに1つの一覧（listbox）で、
//   3つの一覧は1つのスクロール領域を共有し、それぞれ表示範囲だけを描画する（仮想化）。
// - 画面のタイトル行は出さない（見出しは読み上げ用）。トップバーの表示設定（検索・状態・並べ替え）は出さない。
// - 3つの見出しは0件でも残し「該当なし」と表示する。
// - ステータスバーの中央に3セクションの合計件数（取得した対象の総数）。
// - 新しいドラッグ操作・一括操作はない。右の詳細パネルは使わない（行の選択は強調表示だけ。編集はモーダル）。
export function SummaryPage() {
  const day = useLocalDay()
  const query = useQuery(summaryQueryOptions(day))
  const tasksQuery = useQuery(taskListQueryOptions)
  const pendingTaskIds = usePendingTaskIds()
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rowActions = useTaskRowActions({ tasks: tasksQuery.data ?? EMPTY_TASKS, onAnnounce: setAnnouncement })

  const summary = useMemo(() => (query.data ? mergeSummary(query.data, tasksQuery.data) : undefined), [query.data, tasksQuery.data])
  const total = summary ? summary.todayItems.length + summary.tomorrowItems.length + summary.thisWeekItems.length : 0

  // 各セクションの一覧の位置（共有するスクロール領域の内容の先頭から）。行の高さは固定
  let offset = 0
  const sections = SECTIONS.map((section) => {
    const items = summary ? summary[section.key] : []
    const listOffset = offset + HEADING_HEIGHT
    offset = listOffset + (items.length === 0 ? EMPTY_HEIGHT : items.length * TASK_ROW_HEIGHT)
    return { ...section, items, listOffset }
  })

  return (
    <Page title="Summary Review" icon={CalendarCheck} fill titleHidden>
      {query.isSuccess && (
        <ShellSlot name="status-count">
          <Typography component="span" role="status" data-testid="task-count" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {total} 件
          </Typography>
        </ShellSlot>
      )}
      <Box
        role="status"
        aria-live="polite"
        data-testid="task-announcement"
        sx={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
      >
        {announcement}
      </Box>
      <Box sx={{ flexShrink: 0 }}>{rowActions.alerts}</Box>
      {query.isPending ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }} role="status">
          <CircularProgress size={14} aria-hidden />
          <Typography variant="body2">読み込み中…</Typography>
        </Box>
      ) : query.isError ? (
        // 取得に失敗した時は0件として表示しない
        <Alert severity="error" variant="outlined" data-testid="summary-error">
          Summary Review を読み込めませんでした: {query.error.message}
        </Alert>
      ) : (
        <Box
          ref={setScrollElement}
          data-testid="summary-scroll"
          data-today={summary?.today}
          sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
        >
          <Box data-testid="summary-review" sx={{ height: offset }}>
            {sections.map((section) => (
              <Box key={section.key} component="section" aria-labelledby={`summary-heading-${section.key}`} data-section={section.key}>
                <Box
                  sx={{ height: HEADING_HEIGHT, display: 'flex', alignItems: 'flex-end', pb: 0.5, borderBottom: `1px solid ${vscodeColors.border}` }}
                >
                  <Typography
                    id={`summary-heading-${section.key}`}
                    component="h2"
                    sx={{ fontSize: 13, fontWeight: 600, m: 0 }}
                    data-testid="summary-heading"
                    data-count={section.items.length}
                  >
                    {section.label}
                  </Typography>
                  <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary', ml: 1, mb: '1px' }}>
                    {section.items.length} 件
                  </Typography>
                </Box>
                {section.items.length === 0 ? (
                  <Typography
                    sx={{ height: EMPTY_HEIGHT, display: 'flex', alignItems: 'center', px: 2, fontSize: 12, color: 'text.secondary' }}
                    data-testid="summary-empty"
                  >
                    該当なし
                  </Typography>
                ) : (
                  <TaskList
                    variant="section"
                    tasks={section.items}
                    actions={rowActions.actions}
                    externalScroll={{ element: scrollElement, offset: section.listOffset }}
                    listLabel={`${section.label}（${section.items.length}件）`}
                    totalCount={section.items.length}
                    selectedTaskId={selectedId}
                    pendingTaskIds={pendingTaskIds}
                    resetScrollKey={day}
                    onSelect={setSelectedId}
                    onRequestDelete={(task) => rowActions.deleteTasks([task])}
                  />
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}
      {rowActions.elements}
    </Page>
  )
}
