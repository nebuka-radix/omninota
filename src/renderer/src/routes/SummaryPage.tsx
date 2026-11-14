import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { CalendarCheck, CheckCheck, ClockCheck, ClockExclamationPoint } from 'lucide-react'
import type { SummaryReview } from '../../../shared/contracts/summary'
import type { TaskDto } from '../../../shared/contracts/tasks'
import { Page } from '../components/Page'
import { useDayTaskDrag } from '../features/summary/use-day-task-drag'
import { SectionRow } from '../components/SectionRow'
import { useDraftGuard } from '../features/drafts/DraftGuard'
import { ShellSlot } from '../components/ShellSlots'
import { projectListQueryOptions } from '../features/projects/project-queries'
import { filterSummaryByProjects, mergeSummary, summaryTotal } from '../features/summary/summary-merge'
import { summaryProjectFilter, useSummaryExcludedProjects } from '../features/summary/summary-project-filter'
import { summaryQueryOptions } from '../features/summary/summary-queries'
import { TaskQuickAdd } from '../features/tasks/TaskQuickAdd'
import { TaskList } from '../features/tasks/TaskList'
import { taskListQueryOptions, usePendingTaskIds } from '../features/tasks/task-queries'
import { useTaskRowActions } from '../features/tasks/use-task-row-actions'
import { useLocalDay } from '../lib/local-day'
import { vscodeColors } from '../theme'

const HEADING_HEIGHT = 32
type SectionKey = keyof Omit<SummaryReview, 'today'>
// 「田」の字の配置: 左上 Today・右上 This Week・左下 Tomorrow・右下 Overdue
const SECTIONS: { key: SectionKey; label: string; row: 1 | 2; column: 1 | 2 }[] = [
  { key: 'todayItems', label: 'Actions for Today', row: 1, column: 1 },
  { key: 'thisWeekItems', label: 'Actions for This Week', row: 1, column: 2 },
  { key: 'tomorrowItems', label: 'Actions for Tomorrow', row: 2, column: 1 },
  { key: 'overdueItems', label: 'Overdue Actions', row: 2, column: 2 }
]
const EMPTY_TASKS: TaskDto[] = []

// Summary Review。未完了・期限ありのタスクを4区画（2列×2行）に分けて表示する。
// - Today: 今日 / Tomorrow: 明日 / This Week: 明後日〜7日後（両端を含む）/ Overdue: 昨日以前（日数の制限なし）。
//   条件は Main で適用し、判定の「今日」は Main が取得の時点のローカルの暦日で決める。保存の直後は一覧の Query の値で振り分け直す。
// - 2列は同じ幅、2行は同じ高さ（メインパネルの利用できる領域いっぱい）。灰色の外枠と中央の罫線で区切る（境界は1本の線。
//   左の列の右罫線・上の行の下罫線だけを引き、外枠はグリッドの枠線）。各区画は見出しと一覧で、一覧は区画ごとに独立して縦スクロールする
//   （件数で他の区画を押し出さない）。0件でも見出しを残し「該当なし」。狭い幅への自動の1列化はしない。
// - 各行は共通の TaskRow。一覧は区画ごとに仮想化し、区画の寸法の変化は virtualizer が測り直す。
// - 右サイドバーのプロジェクトのフィルター（表示だけ）で OFF のプロジェクトのタスクを全区画から外す。
// - ステータスバーの中央にフィルター後の4区画の合計件数。トップバーの表示設定は出さない。大きな画面タイトルは出さない。
export function SummaryPage({ compact = false, showQuickAdd = true }: {
  compact?: boolean
  showQuickAdd?: boolean
}) {
  const sections = compact ? SECTIONS.filter((section) => section.key === 'todayItems' || section.key === 'tomorrowItems' || section.key === 'overdueItems') : SECTIONS
  const [sectionExpanded, setSectionExpanded] = useState<Partial<Record<SectionKey, boolean>>>({})
  const [sectionError, setSectionError] = useState<string | null>(null)
  const sectionBusy = useRef(false)
  const { confirmLeave } = useDraftGuard()
  const changeSectionExpanded = async (key: SectionKey, next: boolean) => {
    if (sectionBusy.current) return
    sectionBusy.current = true
    try {
      if (!next && !(await confirmLeave())) return
      setSectionError(null)
      setSectionExpanded((current) => ({ ...current, [key]: next }))
    } catch (error) {
      setSectionError(error instanceof Error ? error.message : 'セクションの表示を変更できませんでした')
    } finally { sectionBusy.current = false }
  }
  const day = useLocalDay()
  const query = useQuery(summaryQueryOptions(day))
  const tasksQuery = useQuery(taskListQueryOptions)
  const projectsQuery = useQuery(projectListQueryOptions)
  const pendingTaskIds = usePendingTaskIds()
  const excluded = useSummaryExcludedProjects()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const rowActions = useTaskRowActions({ tasks: tasksQuery.data ?? EMPTY_TASKS, onAnnounce: setAnnouncement })

  // 削除されたプロジェクトの OFF の状態を残さない
  useEffect(() => {
    if (projectsQuery.data) summaryProjectFilter.prune(projectsQuery.data.map((project) => project.id))
  }, [projectsQuery.data])

  const summary = useMemo(
    () => {
      if (!query.data) return undefined
      const merged = mergeSummary(query.data, tasksQuery.data)
      return compact ? merged : filterSummaryByProjects(merged, excluded)
    },
    [query.data, tasksQuery.data, excluded, compact]
  )
  const dayDrag = useDayTaskDrag({
    enabled: compact,
    rows: sections.flatMap((section) => !compact || sectionExpanded[section.key] === false ? [] :
      (summary?.[section.key] ?? []).map((task) => ({ task, section: section.key }))),
    pendingIds: pendingTaskIds,
    onMoved: (day) => setSectionExpanded((current) => ({ ...current, [day === 'today' ? 'todayItems' : 'tomorrowItems']: true })),
    onAnnounce: setAnnouncement
  })
  const total = summary ? compact ? summary.todayItems.length + summary.tomorrowItems.length + summary.overdueItems.length : summaryTotal(summary) : 0

  return (
    <Page title={compact ? 'コンパクト' : 'Summary Review'} icon={CalendarCheck} fill titleHidden>
      {compact && showQuickAdd && <Box sx={{ flexShrink: 0 }}><TaskQuickAdd projectId={null} /></Box>}
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
      {sectionError && <Alert severity="error" onClose={() => setSectionError(null)}>{sectionError}</Alert>}
      {compact && dayDrag.error && <Alert severity="error" onClose={dayDrag.clearError}>{dayDrag.error}</Alert>}
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
          ref={dayDrag.containerRef}
          data-testid="summary-review"
          data-today={summary?.today}
          sx={{
            flex: 1,
            minHeight: 0,
            minWidth: 0,
            display: compact ? 'flex' : 'grid',
            flexDirection: compact ? 'column' : undefined,
            overflowY: compact ? 'auto' : undefined,
            overflowX: compact ? 'hidden' : undefined,
            gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)',
            gridTemplateRows: compact ? undefined : 'minmax(0, 1fr) minmax(0, 1fr)',
            position: 'relative',
            border: compact ? 'none' : `1px solid ${vscodeColors.gridLine}`
          }}
        >
          {sections.map((section) => {
            const items = summary ? summary[section.key] : []
            if (compact && section.key === 'overdueItems' && items.length === 0) return null
            const isExpanded = !compact || sectionExpanded[section.key] !== false
            return (
              <Box
                key={section.key}
                component="section"
                aria-labelledby={`summary-heading-${section.key}`}
                data-section={section.key}
                data-day-drop={compact && section.key === 'todayItems' ? 'today' : compact && section.key === 'tomorrowItems' ? 'tomorrow' : undefined}
                data-testid="summary-section"
                sx={{
                  gridRow: section.row,
                  outline: compact && ((section.key === 'todayItems' && dayDrag.over === 'today') || (section.key === 'tomorrowItems' && dayDrag.over === 'tomorrow')) ? `2px solid ${vscodeColors.focusBorder}` : undefined,
                  outlineOffset: '-2px',
                  flexShrink: compact ? 0 : undefined,
                  gridColumn: compact ? 1 : section.column,
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  minHeight: 0,
                  overflow: 'hidden',
                  // 中央の罫線は左の列の右と上の行の下だけ（二重線にしない）
                  borderRight: !compact && section.column === 1 ? `1px solid ${vscodeColors.gridLine}` : 'none',
                  borderBottom: !compact && section.row === 1 ? `1px solid ${vscodeColors.gridLine}` : 'none'
                }}
              >
                {compact ? (
                  <SectionRow
                    title={section.label}
                    titleId={`summary-heading-${section.key}`}
                    icon={section.key === 'todayItems' ? CheckCheck : section.key === 'tomorrowItems' ? ClockCheck : ClockExclamationPoint}
                    expanded={isExpanded}
                    onExpandedChange={(next) => void changeSectionExpanded(section.key, next)}
                    controlsId={`summary-content-${section.key}`}
                    height={HEADING_HEIGHT}
                  />
                ) : (
                <Box sx={{ height: HEADING_HEIGHT, flexShrink: 0, display: 'flex', alignItems: 'center', px: 1.5, minWidth: 0 }}>
                  <Typography
                    id={`summary-heading-${section.key}`}
                    component="h2"
                    noWrap
                    sx={{ fontSize: 13, fontWeight: 600, m: 0, minWidth: 0 }}
                    data-testid="summary-heading"
                    data-count={items.length}
                  >
                    {section.label}
                  </Typography>
                  <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary', ml: 1, flexShrink: 0 }}>
                    {items.length} 件
                  </Typography>
                </Box>
                )}
                <Box
                  id={`summary-content-${section.key}`}
                  hidden={!isExpanded}
                  sx={{
                    display: isExpanded ? 'flex' : 'none', flexDirection: 'column',
                    flex: compact ? '0 0 auto' : 1, minHeight: 0, minWidth: 0,
                    pl: compact ? '24px' : 0
                  }}
                >
                {items.length === 0 ? (
                  <Typography sx={{ px: 2, py: 1, fontSize: 12, color: 'text.secondary' }} data-testid="summary-empty">
                    該当なし
                  </Typography>
                ) : (
                  <TaskList
                    variant="section"
                    rowMode="Standard"
                    multiSelect={compact ? {
                      selection: dayDrag.selection,
                      onChange: dayDrag.changeSelection,
                      onShowDetail: (id) => {
                        setSelectedId(id)
                        const task = tasksQuery.data?.find((item) => item.id === id)
                        const anchor = document.getElementById(`task-option-${id}`)
                        if (task && anchor) rowActions.actions.openEditor(task, anchor)
                      }
                    } : undefined}
                    onRowDragStart={compact ? dayDrag.start : undefined}
                    maxVisibleRows={compact ? Math.max(1, items.length) : undefined}
                    tasks={items}
                    actions={rowActions.actions}
                    listLabel={`${section.label}（${items.length}件）`}
                    totalCount={items.length}
                    selectedTaskId={selectedId}
                    pendingTaskIds={pendingTaskIds}
                    resetScrollKey={day}
                    onSelect={setSelectedId}
                    onRequestDelete={(task) => rowActions.deleteTasks([task])}
                  />
                )}
                </Box>
              </Box>
            )
          })}
        </Box>
      )}
      {compact && dayDrag.elements}
      {rowActions.elements}
    </Page>
  )
}

