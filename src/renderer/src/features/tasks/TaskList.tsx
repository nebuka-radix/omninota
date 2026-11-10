import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Box, Button, ButtonBase, Checkbox, Typography } from '@mui/material'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, Link2 } from 'lucide-react'
import type { SortingState } from '@tanstack/react-table'
import { isTaskCompleted, type TaskDto } from '../../../../shared/contracts/tasks'
import { vscodeColors } from '../../theme'
import type { TaskSortColumn } from './task-table'

// 固定行高（可変行高は将来の課題）。仮想行にMotionのlayoutアニメーションは付けない。
export const TASK_ROW_HEIGHT = 34
const DATE_COLUMN_WIDTH = 132
const ASSIGN_COLUMN_WIDTH = 88
const gridColumns = (withAssign: boolean, card: boolean) =>
  card ? '32px minmax(0, 1fr)' : `40px minmax(0, 1fr) ${withAssign ? `${ASSIGN_COLUMN_WIDTH}px ` : ''}${DATE_COLUMN_WIDTH}px`
const PAGE_STEP = 10

const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})
// 日時として読めない値（古いデータ・取得のずれなど）でも画面全体を止めないよう、そのままの文字列を表示する
export const formatTaskDateTime = (iso: string) => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : dateTimeFormat.format(date)
}

export const taskOptionId = (taskId: string) => `task-option-${taskId}`

export function SortHeader({
  column,
  label,
  sorting,
  onSort,
  align = 'left'
}: {
  column: TaskSortColumn
  label: string
  sorting: SortingState
  onSort: (column: TaskSortColumn) => void
  align?: 'left' | 'right'
}) {
  const active = sorting[0]?.id === column ? sorting[0] : undefined
  const direction = active ? (active.desc ? '降順' : '昇順') : null
  const Icon = active?.desc ? ArrowDown : ArrowUp
  return (
    <ButtonBase
      onClick={() => onSort(column)}
      aria-label={`${label}で並べ替え${direction ? `（現在: ${direction}）` : ''}`}
      aria-pressed={active !== undefined}
      sx={{
        justifyContent: align === 'right' ? 'flex-end' : 'flex-start',
        gap: 1,
        px: 2,
        height: '100%',
        fontSize: 12,
        fontWeight: 600,
        color: active ? 'text.primary' : 'text.secondary'
      }}
    >
      {label}
      {active && <Icon size={12} aria-hidden />}
    </ButtonBase>
  )
}

export const TASK_LIST_HELP_ID = 'task-list-help'

// 1件選択のリスト（role="listbox"）。DOMフォーカスはリスト本体に置き、
// 現在行は aria-activedescendant で示す（仮想化で行要素が入れ替わってもフォーカスを失わない）。
// - 上下キー・Home/End・PageUp/PageDown: 現在行の移動（選択は変えない。見出し行は飛ばす）
// - Enter: 現在行を選択して詳細パネルに表示
// - Space: 現在行の完了／未完了を切り替える（行の選択は変えない）
// - M: 現在行の「紐付け」メニューを開く（onRequestAssign がある場合。フェーズ5.4）
// - 行のチェックボックスはマウス用。キーボード・読み上げでは上記のSpaceで同じ操作を行う
//   （option内に操作要素を置けないため。Tab移動の対象も増やさない）
// 「紐付け」ボタンは listbox の外側の重ね合わせ層に描画し、option の中に操作要素を置かない。
// フェーズ5.5: variant="card" はマイルストンのカード内の一覧（列見出し・作成日時の列なし。カードごとに1つの仮想リスト）。
// - ← → : 隣のカードの一覧へフォーカスを移す（onNavigateCard）
// - 5.4 の「見出し行とタスク行を1つの仮想リストに並べる」方式は、カード表示への置き換えに伴い廃止した。
export function TaskList({
  tasks,
  variant = 'table',
  listLabel,
  cardKey,
  emptyLabel,
  onNavigateCard,
  onRequestAssign,
  totalCount,
  selectedTaskId,
  pendingTaskIds,
  sorting,
  resetScrollKey,
  onSort,
  onSelect,
  onToggleCompleted
}: {
  tasks: readonly TaskDto[]
  variant?: 'table' | 'card'
  // 一覧の読み上げ名（省略時は「タスク一覧（N件表示 / 全N件）」）
  listLabel?: string
  // カードの識別（隣のカードへの移動で使う）
  cardKey?: string
  // タスクが0件の時の表示（カード）
  emptyLabel?: string
  onNavigateCard?: (direction: -1 | 1) => void
  // 行の「紐付け」（Inbox）。anchor はメニューを表示する位置の要素
  onRequestAssign?: (task: TaskDto, anchor: HTMLElement) => void
  totalCount: number
  selectedTaskId: string | null
  pendingTaskIds: ReadonlySet<string>
  sorting: SortingState
  // 検索・表示切り替え・ソートが変わったら先頭へスクロールする（データ更新だけでは戻さない）
  resetScrollKey: string
  onSort: (column: TaskSortColumn) => void
  onSelect: (taskId: string) => void
  onToggleCompleted: (task: TaskDto) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [listFocused, setListFocused] = useState(false)
  const card = variant === 'card'
  const withAssign = onRequestAssign !== undefined && !card
  const GRID_COLUMNS = gridColumns(withAssign, card)
  // キーボード移動の対象となるタスクの並び（行の並びと同じ）
  const orderedTasks = tasks

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TASK_ROW_HEIGHT,
    // 安定したキー（タスクID）。1つのタスクは1つのカードにだけ表示されるため、カード間でも衝突しない
    getItemKey: (index) => tasks[index]?.id ?? index,
    overscan: 8
  })

  // 条件（resetScrollKey）が変わった時だけ先頭へ戻す。virtualizerは毎回同じインスタンス。
  useEffect(() => {
    virtualizer.scrollToOffset(0)
  }, [resetScrollKey, virtualizer])

  const scrollToTask = (taskIndex: number) => {
    virtualizer.scrollToIndex(taskIndex, { align: 'auto' })
  }

  const activeIndex = activeTaskId === null ? -1 : orderedTasks.findIndex((task) => task.id === activeTaskId)

  // 現在行が一覧から消えた時（完了して未完了の表示から外れた・所属を変えた等）、フォーカス中なら同じ位置の行へ移す。
  // 古い行番号ではなく、直前に現在行だった位置だけを手がかりに、現在の一覧から選び直す。
  const lastActiveIndexRef = useRef(-1)
  if (activeIndex >= 0) lastActiveIndexRef.current = activeIndex
  useLayoutEffect(() => {
    if (activeTaskId === null || activeIndex >= 0) return
    if (!listFocused || orderedTasks.length === 0) {
      setActiveTaskId(null)
      return
    }
    const nextIndex = Math.max(0, Math.min(lastActiveIndexRef.current, orderedTasks.length - 1))
    const next = orderedTasks[nextIndex]
    setActiveTaskId(next ? next.id : null)
    if (next) virtualizer.scrollToIndex(nextIndex, { align: 'auto' })
  }, [activeTaskId, activeIndex, listFocused, orderedTasks, virtualizer])

  const moveTo = (index: number) => {
    if (orderedTasks.length === 0) return
    const clamped = Math.max(0, Math.min(orderedTasks.length - 1, index))
    const target = orderedTasks[clamped]
    if (!target) return
    setActiveTaskId(target.id)
    scrollToTask(clamped)
  }

  const startIndex = () => {
    if (activeIndex >= 0) return activeIndex
    const selectedIndex = selectedTaskId ? orderedTasks.findIndex((task) => task.id === selectedTaskId) : -1
    return selectedIndex >= 0 ? selectedIndex : 0
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    // カード: 隣のカードの一覧へ（空のカードからも移れる）
    if (onNavigateCard && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      onNavigateCard(event.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    if (orderedTasks.length === 0) return
    const current = startIndex()
    let handled = true
    switch (event.key) {
      case 'ArrowDown':
        moveTo(activeIndex < 0 ? current : current + 1)
        break
      case 'ArrowUp':
        moveTo(activeIndex < 0 ? current : current - 1)
        break
      case 'Home':
        moveTo(0)
        break
      case 'End':
        moveTo(orderedTasks.length - 1)
        break
      case 'PageDown':
        moveTo(current + PAGE_STEP)
        break
      case 'PageUp':
        moveTo(current - PAGE_STEP)
        break
      case 'Enter': {
        const target = orderedTasks[current]
        if (target) {
          setActiveTaskId(target.id)
          onSelect(target.id)
        }
        break
      }
      case ' ': {
        // 現在行の完了切り替え。現在行がなければ表示範囲の行を現在行にするだけ（意図しない行を操作しない）
        const target = activeIndex >= 0 ? orderedTasks[activeIndex] : undefined
        if (target) onToggleCompleted(target)
        else moveTo(current)
        break
      }
      case 'm':
      case 'M': {
        // 現在行の紐付けメニュー（現在行がなければ現在行を決めるだけ）
        if (!onRequestAssign || event.metaKey || event.ctrlKey || event.altKey) {
          handled = false
          break
        }
        const target = activeIndex >= 0 ? orderedTasks[activeIndex] : undefined
        if (target) {
          const anchor = document.getElementById(taskOptionId(target.id)) ?? listRef.current
          if (anchor) onRequestAssign(target, anchor)
        } else moveTo(current)
        break
      }
      default:
        handled = false
    }
    if (handled) event.preventDefault()
  }

  // フォーカス時はスクロールしない（クリックでフォーカスした時に表示位置が動き、別の行を押してしまうため）。
  // 現在行がなければ、表示中の選択行、なければ表示範囲の先頭のタスク行を現在行にする。
  const handleFocus = () => {
    setListFocused(true)
    if (activeIndex >= 0 || orderedTasks.length === 0) return
    const scrollTop = scrollRef.current?.scrollTop ?? 0
    const items = virtualizer.getVirtualItems()
    const taskOf = (index: number) => tasks[index]
    const selectedItem = items.find((item) => taskOf(item.index)?.id === selectedTaskId)
    const firstInView = items.find((item) => item.end > scrollTop)
    const chosen = selectedItem ?? firstInView ?? items[0]
    const target = chosen ? taskOf(chosen.index) : orderedTasks[0]
    if (target) setActiveTaskId(target.id)
  }

  // aria-activedescendant は描画済みの行だけを参照する（未描画の行はスクロール後の再描画で参照する）
  const virtualItems = virtualizer.getVirtualItems()
  const activeRendered = activeIndex >= 0 && virtualItems.some((item) => item.index === activeIndex)
  const activeTask = activeIndex >= 0 ? orderedTasks[activeIndex] : undefined
  const activeId = activeRendered && activeTask ? taskOptionId(activeTask.id) : undefined

  const rowBox = (start: number) => ({
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: TASK_ROW_HEIGHT,
    transform: `translateY(${start}px)`
  })

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
      {!card && (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: GRID_COLUMNS,
          height: 28,
          flexShrink: 0,
          borderBottom: `1px solid ${vscodeColors.border}`
        }}
      >
        <span aria-hidden />
        <SortHeader column="title" label="タイトル" sorting={sorting} onSort={onSort} />
        {withAssign && <span aria-hidden />}
        <SortHeader column="createdAt" label="作成日時" sorting={sorting} onSort={onSort} align="right" />
      </Box>
      )}
      <Box ref={scrollRef} data-testid="task-list-scroll" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {/* カードでは、タスクが少なくても一覧（フォーカス先）がカードの高さいっぱいに広がるようにする */}
        <Box sx={{ position: 'relative', height: virtualizer.getTotalSize(), minHeight: card ? '100%' : undefined }}>
          <Box
            ref={listRef}
            role="listbox"
            aria-label={listLabel ?? `タスク一覧（${orderedTasks.length}件表示 / 全${totalCount}件）`}
            aria-describedby={TASK_LIST_HELP_ID}
            aria-activedescendant={listFocused ? activeId : undefined}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={() => setListFocused(false)}
            data-testid="task-list"
            data-card-list={cardKey}
            sx={{
              position: 'absolute',
              inset: 0,
              // 現在行があればその行の枠線でフォーカスを示す。空のカードでは一覧全体の枠線で示す
              outline: card && listFocused && activeId === undefined ? `1px solid ${vscodeColors.focusBorder}` : 'none',
              outlineOffset: -1
            }}
          >
            {virtualItems.map((item) => {
              const task = tasks[item.index]
              if (!task) return null
              const completed = isTaskCompleted(task)
              const selected = task.id === selectedTaskId
              const active = listFocused && item.index === activeIndex
              const pending = pendingTaskIds.has(task.id)
              return (
                <Box
                  key={task.id}
                  id={taskOptionId(task.id)}
                  role="option"
                  aria-selected={selected}
                  // 読み上げ名に対象のタスク名・完了状態・マイルストンを含める（チェックボックスは読み上げ対象外）
                  aria-label={`${task.title}、${completed ? '完了' : '未完了'}、作成 ${formatTaskDateTime(task.createdAt)}`}
                  data-task-id={task.id}
                  onClick={() => {
                    setActiveTaskId(task.id)
                    onSelect(task.id)
                  }}
                  sx={{
                    ...rowBox(item.start),
                    display: 'grid',
                    gridTemplateColumns: GRID_COLUMNS,
                    alignItems: 'center',
                    cursor: 'default',
                    bgcolor: selected ? vscodeColors.listActiveSelection : 'transparent',
                    // キーボードの現在行（フォーカス）は枠線、選択は背景色で区別する
                    outline: active ? `1px solid ${vscodeColors.focusBorder}` : 'none',
                    outlineOffset: -1,
                    '&:hover': { bgcolor: selected ? vscodeColors.listActiveSelection : vscodeColors.listHover }
                  }}
                >
                  <Box
                    sx={{ display: 'flex', justifyContent: 'center' }}
                    // チェック操作で行選択（詳細パネルの切り替え）を起こさない
                    onClick={(event) => event.stopPropagation()}
                    aria-hidden
                  >
                    <Checkbox
                      size="small"
                      checked={completed}
                      disabled={pending}
                      onChange={() => onToggleCompleted(task)}
                      tabIndex={-1}
                      slotProps={{ input: { 'aria-hidden': true, tabIndex: -1 } }}
                      sx={{ p: 0.5 }}
                    />
                  </Box>
                  <Typography
                    component="span"
                    noWrap
                    sx={{
                      fontSize: 13,
                      px: 2,
                      // 完了は色だけでなく取り消し線でも示す
                      textDecoration: completed ? 'line-through' : 'none',
                      color: completed ? 'text.secondary' : 'text.primary'
                    }}
                  >
                    {task.title}
                  </Typography>
                  {withAssign && <span aria-hidden />}
                  {!card && (
                    <Typography component="span" noWrap sx={{ fontSize: 12, px: 2, textAlign: 'right', color: 'text.secondary' }}>
                      {formatTaskDateTime(task.createdAt)}
                    </Typography>
                  )}
                </Box>
              )
            })}
          </Box>
          {/* listbox の外側の重ね合わせ層: 「紐付け」ボタン（option の中に操作要素を置かない）と、空のカードの表示 */}
          <Box sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} data-testid="task-list-overlay">
            {tasks.length === 0 && emptyLabel && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 2, py: 1.5, m: 0 }} aria-hidden>
                {emptyLabel}
              </Typography>
            )}
            {withAssign &&
              onRequestAssign &&
              virtualItems.map((item) => {
                const task = tasks[item.index]
                if (!task) return null
                const pending = pendingTaskIds.has(task.id)
                return (
                  <Box
                    key={`assign-${task.id}`}
                    sx={{
                      ...rowBox(item.start),
                      width: ASSIGN_COLUMN_WIDTH,
                      left: 'auto',
                      right: DATE_COLUMN_WIDTH,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      pointerEvents: 'auto'
                    }}
                  >
                    {/* マウス用の入口（Tab移動の対象は増やさない。キーボードは一覧で M キー） */}
                    <Button
                      size="small"
                      variant="outlined"
                      tabIndex={-1}
                      disabled={pending}
                      startIcon={<Link2 size={12} aria-hidden />}
                      aria-label={`「${task.title}」を紐付け`}
                      data-assign-task-id={task.id}
                      onClick={(event) => onRequestAssign(task, event.currentTarget)}
                      sx={{ minWidth: 0, px: 1, py: 0, fontSize: 11, height: 22 }}
                    >
                      紐付け
                    </Button>
                  </Box>
                )
              })}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
