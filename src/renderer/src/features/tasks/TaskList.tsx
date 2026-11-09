import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Box, ButtonBase, Checkbox, Typography } from '@mui/material'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { SortingState } from '@tanstack/react-table'
import { isTaskCompleted, type TaskDto } from '../../../../shared/contracts/tasks'
import { vscodeColors } from '../../theme'
import type { TaskSortColumn } from './task-table'

// 固定行高（可変行高は将来の課題）。仮想行にMotionのlayoutアニメーションは付けない。
export const TASK_ROW_HEIGHT = 34
const GRID_COLUMNS = '40px minmax(0, 1fr) 132px'
const PAGE_STEP = 10

const dateTimeFormat = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit'
})
export const formatTaskDateTime = (iso: string) => dateTimeFormat.format(new Date(iso))

export const taskOptionId = (taskId: string) => `task-option-${taskId}`

function SortHeader({
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

// 1件選択のリスト（role="listbox"）。DOMフォーカスはリスト本体に置き、
// 現在行は aria-activedescendant で示す（仮想化で行要素が入れ替わってもフォーカスを失わない）。
// - 上下キー・Home/End・PageUp/PageDown: 現在行の移動（選択は変えない）
// - Enter / Space: 現在行を選択して詳細パネルに表示
// - 完了チェックはマウス操作用（キーボードでは詳細パネルのボタンを使う）
export function TaskList({
  tasks,
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

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TASK_ROW_HEIGHT,
    getItemKey: (index) => tasks[index]?.id ?? index,
    overscan: 8
  })

  // 条件（resetScrollKey）が変わった時だけ先頭へ戻す。virtualizerは毎回同じインスタンス。
  useEffect(() => {
    virtualizer.scrollToOffset(0)
  }, [resetScrollKey, virtualizer])

  const activeIndex = activeTaskId === null ? -1 : tasks.findIndex((task) => task.id === activeTaskId)

  const moveTo = (index: number) => {
    if (tasks.length === 0) return
    const clamped = Math.max(0, Math.min(tasks.length - 1, index))
    const target = tasks[clamped]
    if (!target) return
    setActiveTaskId(target.id)
    virtualizer.scrollToIndex(clamped, { align: 'auto' })
  }

  const startIndex = () => {
    if (activeIndex >= 0) return activeIndex
    const selectedIndex = selectedTaskId ? tasks.findIndex((task) => task.id === selectedTaskId) : -1
    return selectedIndex >= 0 ? selectedIndex : 0
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || tasks.length === 0) return
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
        moveTo(tasks.length - 1)
        break
      case 'PageDown':
        moveTo(current + PAGE_STEP)
        break
      case 'PageUp':
        moveTo(current - PAGE_STEP)
        break
      case 'Enter':
      case ' ': {
        const target = tasks[current]
        if (target) {
          setActiveTaskId(target.id)
          onSelect(target.id)
        }
        break
      }
      default:
        handled = false
    }
    if (handled) event.preventDefault()
  }

  // フォーカス時はスクロールしない（クリックでフォーカスした時に表示位置が動き、別の行を押してしまうため）。
  // 現在行がなければ、表示中の選択行、なければ表示範囲の先頭行を現在行にする。
  const handleFocus = () => {
    setListFocused(true)
    if (activeIndex >= 0 || tasks.length === 0) return
    const scrollTop = scrollRef.current?.scrollTop ?? 0
    const items = virtualizer.getVirtualItems()
    const selectedItem = items.find((item) => tasks[item.index]?.id === selectedTaskId)
    const firstInView = items.find((item) => item.end > scrollTop)
    const target = tasks[(selectedItem ?? firstInView ?? items[0])?.index ?? 0]
    if (target) setActiveTaskId(target.id)
  }

  const activeId = activeIndex >= 0 && tasks[activeIndex] ? taskOptionId(tasks[activeIndex].id) : undefined

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
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
        <SortHeader column="createdAt" label="作成日時" sorting={sorting} onSort={onSort} align="right" />
      </Box>
      <Box ref={scrollRef} data-testid="task-list-scroll" sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        <Box
          ref={listRef}
          role="listbox"
          aria-label={`タスク一覧（${tasks.length}件表示 / 全${totalCount}件）`}
          aria-activedescendant={listFocused ? activeId : undefined}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={() => setListFocused(false)}
          data-testid="task-list"
          sx={{ position: 'relative', height: virtualizer.getTotalSize(), outline: 'none' }}
        >
          {virtualizer.getVirtualItems().map((item) => {
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
                aria-label={`${task.title}${completed ? '（完了）' : ''}、作成 ${formatTaskDateTime(task.createdAt)}`}
                data-task-id={task.id}
                onClick={() => {
                  setActiveTaskId(task.id)
                  onSelect(task.id)
                }}
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: TASK_ROW_HEIGHT,
                  transform: `translateY(${item.start}px)`,
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
                <Typography component="span" noWrap sx={{ fontSize: 12, px: 2, textAlign: 'right', color: 'text.secondary' }}>
                  {formatTaskDateTime(task.createdAt)}
                </Typography>
              </Box>
            )
          })}
        </Box>
      </Box>
    </Box>
  )
}
