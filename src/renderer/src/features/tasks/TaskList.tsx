import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { Box, ButtonBase, Typography } from '@mui/material'
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react'
import type { SortingState } from '@tanstack/react-table'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { useLocalDay } from '../../lib/local-day'
import { vscodeColors } from '../../theme'
import { usePendingClick } from './pending-click'
import { nearestRemaining, selectAll, selectOnly, selectRange, toggleSelection, EMPTY_SELECTION, type TaskSelection } from './selection'
import type { TaskSortColumn } from './task-table'
import { TaskRow, TASK_ROW_HEIGHT, taskOptionId, type TaskRowActions } from './TaskRow'

export { TASK_ROW_HEIGHT, taskOptionId }
const PAGE_STEP = 10
// 行のドラッグ（Inbox → 紐付け先）を始める移動量（px）。これより小さい移動はクリック・ダブルクリックとして扱う
const DRAG_THRESHOLD = 5
const AUTOSCROLL_EDGE = 28
const AUTOSCROLL_STEP = 12

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

// Inboxの複数選択（フェーズ5.9）。選択集合は呼び出し側が持つ（仮想化で行がアンマウントされても失わない）
export type MultiSelectOptions = {
  selection: TaskSelection
  onChange: (next: TaskSelection) => void
  // Enter・メニューの「詳細を表示」: 右サイドバーをタスクの詳細に切り替える（明示的な操作）
  onShowDetail: (taskId: string) => void
}

// カード内のタスクの並べ替え（フェーズ5.9）。同じマイルストン内だけ。カード間の移動はしない
export type ReorderOptions = {
  // 絞り込み中（検索あり・状態が「すべて」以外）は無効。その理由
  disabledReason: string | null
  // 並べ替えが「手動順」か（違えば、並べ替えると手動順へ切り替わることを示す）
  manual: boolean
  // 新しい順序（このカードのタスク全件のID）。保存は呼び出し側（Mainで検証）
  onMove: (orderedIds: string[], movedTaskId: string) => void
  onBlocked: (reason: string) => void
}

// 外部のスクロール領域で仮想化する一覧（Summary Review のセクション。複数の一覧で1つのスクロール領域を共有する）
export type ExternalScroll = {
  element: HTMLElement | null
  // スクロール領域の内容の先頭から、この一覧の先頭までの距離（px）
  offset: number
}

// タスクの一覧（role="listbox"）。各行は共通の TaskRow（Inbox・プロジェクトのカード・Summary Review）。
// DOMフォーカスはリスト本体に置き、現在行は aria-activedescendant で示す（仮想化で行要素が入れ替わってもフォーカスを失わない）。
// - 上下キー・Home/End・PageUp/PageDown: 現在行の移動（選択は変えない）
// - Enter: 現在行を選択して詳細を表示（Inboxは右サイドバーを「タスク詳細」に切り替える）
// - Space: 現在行の完了／未完了を切り替える（行の選択は変えない）
// - E: 現在行のタスク編集モーダル（マウスはタスク名のクリック）
// - F2: タスク名のインライン編集（マウスはタスク名のダブルクリック）
// - F: お気に入りの切り替え / D: 期限のメニュー
// - M: 紐付けメニュー（Inbox は現在行が選択に含まれていれば選択中のタスクすべて＝onRequestAssignKey。それ以外は現在行の1件）
// - Delete / Backspace: 削除（確認なし。Inboxは現在行が選択に含まれていれば選択中のタスクすべて）
// - Shift+F10 / ContextMenu キー: 行の「…」メニュー（削除だけ）
// - Inboxの複数選択（フェーズ5.9）: Shift+↑↓ で範囲選択、X で現在行の選択の追加・解除、⌘A ですべて選択、Esc で選択解除。
//   マウスは ⌘+クリックで追加・解除、Shift+クリックで範囲選択（現在の表示順）。修飾キー付きのタスク名のクリックも複数選択（モーダルは開かない）。
// - カードの並べ替え（フェーズ5.9）: Alt+↑↓ で現在行を上下へ移動。マウスは行の先頭のハンドルをドラッグ（Esc で取り消し）。
// マウス:
// - 行の背景のクリック: 選択（既存どおり）。タスク名のクリック: 少し待ってから編集モーダル（ダブルクリックならモーダルを開かずインライン編集）。
//   保留中のクリックは、ドラッグの開始・他の操作・アンマウントで取り消す（pending-click.ts）。ドラッグはクリックとして扱わない。
// variant: table（Inbox。並べ替えの見出しあり）/ card（マイルストンのカード。← → で隣のカードへ）/ section（Summary Review。外部のスクロール領域）
export function TaskList({
  tasks,
  actions,
  variant = 'table',
  listLabel,
  cardKey,
  emptyLabel,
  maxVisibleRows,
  externalScroll,
  onNavigateCard,
  onRequestAssignKey,
  onRequestDelete,
  totalCount,
  selectedTaskId,
  pendingTaskIds,
  sorting,
  resetScrollKey,
  onSort,
  onSelect,
  multiSelect,
  onRowDragStart,
  reorder
}: {
  tasks: readonly TaskDto[]
  actions: TaskRowActions
  variant?: 'table' | 'card' | 'section'
  // 一覧の読み上げ名（省略時は「タスク一覧（N件表示 / 全N件）」）
  listLabel?: string
  // カードの識別（隣のカードへの移動で使う）
  cardKey?: string
  // タスクが0件の時の表示（カード）
  emptyLabel?: string
  // 行数に合わせて高さを決める場合の最大行数（row レイアウトのカード。フェーズ5.9）。省略時は親の高さいっぱい
  maxVisibleRows?: number
  // variant="section" の外部のスクロール領域
  externalScroll?: ExternalScroll
  onNavigateCard?: (direction: -1 | 1) => void
  // M キー（Inbox: 選択中のタスクの一括紐付け）。省略時は現在行の1件の紐付けメニュー
  onRequestAssignKey?: (task: TaskDto, anchor: HTMLElement) => void
  // Delete キー（確認なし。Inbox: 選択中のタスクの一括削除）
  onRequestDelete: (task: TaskDto) => void
  totalCount: number
  selectedTaskId: string | null
  pendingTaskIds: ReadonlySet<string>
  sorting?: SortingState
  // 検索・表示切り替え・ソートが変わったら先頭へスクロールする（データ更新だけでは戻さない）
  resetScrollKey: string
  onSort?: (column: TaskSortColumn) => void
  onSelect: (taskId: string) => void
  multiSelect?: MultiSelectOptions
  // 行のドラッグの開始（Inbox → 紐付け先。フェーズ5.9）。しきい値を超えて動かした時に呼ぶ
  onRowDragStart?: (task: TaskDto, point: { x: number; y: number }) => void
  reorder?: ReorderOptions
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [listFocused, setListFocused] = useState(false)
  const card = variant === 'card'
  const section = variant === 'section'
  const withHandle = card && reorder !== undefined
  const inlineEdit = actions.inlineEdit
  const today = useLocalDay()
  const listId = `task-list-${useId().replace(/:/g, '')}`
  // 行の操作ボタン（TaskRow がポータルで描画する重ね合わせ層）
  const [controlsLayer, setControlsLayer] = useState<HTMLElement | null>(null)
  const pendingClick = usePendingClick()
  // 外部のスクロール領域を使う場合（section）の位置
  const scrollOffset = section ? externalScroll?.offset ?? 0 : 0
  // キーボード移動の対象となるタスクの並び（行の並びと同じ）
  const orderedTasks = tasks
  const order = tasks.map((task) => task.id)
  const editingTaskId = inlineEdit.state?.taskId ?? null
  const editingIndex = editingTaskId === null ? -1 : tasks.findIndex((task) => task.id === editingTaskId)

  // 並べ替えのドラッグ中の状態（挿入位置 0..n）
  const [reorderDrag, setReorderDrag] = useState<{ taskId: string; fromIndex: number; insertIndex: number } | null>(null)

  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => (section ? externalScroll?.element ?? null : scrollRef.current),
    scrollMargin: scrollOffset,
    estimateSize: () => TASK_ROW_HEIGHT,
    // 安定したキー（タスクID）。1つのタスクは1つのカードにだけ表示されるため、カード間でも衝突しない
    getItemKey: (index) => tasks[index]?.id ?? index,
    overscan: 8,
    // 編集中の行は表示範囲の外でも描画し続ける（スクロールで入力欄がアンマウントされないようにする。フェーズ5.9）
    rangeExtractor: useCallback(
      (range: Range) => {
        const indexes = defaultRangeExtractor(range)
        if (editingIndex >= 0 && !indexes.includes(editingIndex)) return [...indexes, editingIndex].sort((a, b) => a - b)
        return indexes
      },
      [editingIndex]
    )
  })

  // 条件（resetScrollKey）が変わった時だけ先頭へ戻す。virtualizerは毎回同じインスタンス。
  useEffect(() => {
    if (!section) virtualizer.scrollToOffset(0)
  }, [resetScrollKey, virtualizer, section])

  const scrollToTask = (taskIndex: number) => {
    virtualizer.scrollToIndex(taskIndex, { align: 'auto' })
  }

  const activeIndex = activeTaskId === null ? -1 : orderedTasks.findIndex((task) => task.id === activeTaskId)

  // 現在行が一覧から消えた時（完了して未完了の表示から外れた・紐付け・削除など）、消える前の位置から最も近い残りの行
  // （後ろを優先）へ移す（フェーズ5.9: 複数行が一度に消えても、元の位置の次に残った行。フォーカスがない時も移す。残りがなければ現在行なし）。
  const lastActiveIndexRef = useRef(-1)
  if (activeIndex >= 0) lastActiveIndexRef.current = activeIndex
  // 直前の描画の表示順（現在行の移り先を、消える前の並びから決めるため）
  const previousOrderRef = useRef<readonly string[]>([])
  useLayoutEffect(() => {
    if (activeTaskId === null || activeIndex >= 0) return
    if (orderedTasks.length === 0) {
      setActiveTaskId(null)
      return
    }
    const previous = previousOrderRef.current
    const current = new Set(orderedTasks.map((task) => task.id))
    const removed = new Set(previous.filter((id) => !current.has(id)))
    const previousIndex = previous.indexOf(activeTaskId)
    const nextId = previousIndex >= 0 ? nearestRemaining(previous, removed, previousIndex) : null
    const fallbackIndex = Math.max(0, Math.min(lastActiveIndexRef.current, orderedTasks.length - 1))
    const nextIndex = nextId !== null ? orderedTasks.findIndex((task) => task.id === nextId) : fallbackIndex
    const next = orderedTasks[nextIndex >= 0 ? nextIndex : fallbackIndex]
    setActiveTaskId(next ? next.id : null)
    if (next && listFocused) virtualizer.scrollToIndex(nextIndex >= 0 ? nextIndex : fallbackIndex, { align: 'auto' })
  }, [activeTaskId, activeIndex, listFocused, orderedTasks, virtualizer])
  useLayoutEffect(() => {
    previousOrderRef.current = orderedTasks.map((task) => task.id)
  }, [orderedTasks])

  const moveTo = (index: number) => {
    if (orderedTasks.length === 0) return null
    const clamped = Math.max(0, Math.min(orderedTasks.length - 1, index))
    const target = orderedTasks[clamped]
    if (!target) return null
    setActiveTaskId(target.id)
    scrollToTask(clamped)
    return target
  }

  const startIndex = () => {
    if (activeIndex >= 0) return activeIndex
    const selectedIndex = selectedTaskId ? orderedTasks.findIndex((task) => task.id === selectedTaskId) : -1
    return selectedIndex >= 0 ? selectedIndex : 0
  }

  const focusList = () => listRef.current?.focus({ preventScroll: true })

  const startEdit = (task: TaskDto) => {
    pendingClick.cancel()
    if (pendingTaskIds.has(task.id)) return
    setActiveTaskId(task.id)
    void inlineEdit.start(task)
  }

  // 現在行の要素（キーボードから開くメニュー・モーダルの位置と、閉じた後のフォーカスの戻り先）
  const anchorOf = (task: TaskDto) => document.getElementById(taskOptionId(task.id)) ?? listRef.current

  // 並べ替え（キーボード Alt+↑↓・ハンドルのドラッグ）で、このカードのタスクの新しい順序を作る
  const moveRow = (taskId: string, toIndex: number) => {
    if (!reorder) return
    const from = order.indexOf(taskId)
    if (from < 0) return
    const target = Math.max(0, Math.min(order.length - 1, toIndex))
    if (target === from) return
    const next = [...order]
    next.splice(from, 1)
    next.splice(target, 0, taskId)
    reorder.onMove(next, taskId)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    pendingClick.cancel()
    const meta = event.metaKey || event.ctrlKey
    // カードの並べ替え（Alt+↑↓）
    if (reorder && event.altKey && !meta && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault()
      const target = activeIndex >= 0 ? orderedTasks[activeIndex] : undefined
      if (!target) return void moveTo(startIndex())
      if (reorder.disabledReason) return reorder.onBlocked(reorder.disabledReason)
      if (pendingTaskIds.has(target.id)) return
      moveRow(target.id, activeIndex + (event.key === 'ArrowUp' ? -1 : 1))
      return
    }
    // カード: 隣のカードの一覧へ（空のカードからも移れる）
    if (onNavigateCard && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !meta && !event.altKey) {
      event.preventDefault()
      onNavigateCard(event.key === 'ArrowLeft' ? -1 : 1)
      return
    }
    // 複数選択: すべて選択（⌘A）・選択解除（Esc）
    if (multiSelect && meta && !event.altKey && (event.key === 'a' || event.key === 'A')) {
      event.preventDefault()
      multiSelect.onChange(selectAll(order))
      return
    }
    if (multiSelect && event.key === 'Escape' && multiSelect.selection.ids.size > 0) {
      event.preventDefault()
      multiSelect.onChange(EMPTY_SELECTION)
      return
    }
    if (orderedTasks.length === 0) return
    const current = startIndex()
    const activeTask = activeIndex >= 0 ? orderedTasks[activeIndex] : undefined
    // 範囲選択（Shift+↑↓）: 基準行がなければ移動前の現在行を基準にする
    if (multiSelect && event.shiftKey && !meta && !event.altKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      const base = activeTask ?? orderedTasks[current]
      if (!base) return
      const anchored =
        multiSelect.selection.anchorId !== null && order.includes(multiSelect.selection.anchorId)
          ? multiSelect.selection
          : { ids: multiSelect.selection.ids, anchorId: base.id }
      const moved = activeTask ? moveTo(current + (event.key === 'ArrowDown' ? 1 : -1)) : moveTo(current)
      if (moved) multiSelect.onChange(selectRange(anchored, moved.id, order))
      return
    }
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
          if (multiSelect) {
            multiSelect.onChange(selectOnly(target.id))
            multiSelect.onShowDetail(target.id)
          } else onSelect(target.id)
        }
        break
      }
      case ' ': {
        // 現在行の完了切り替え。現在行がなければ表示範囲の行を現在行にするだけ（意図しない行を操作しない）
        if (activeTask) actions.toggleCompleted(activeTask)
        else moveTo(current)
        break
      }
      case 'x':
      case 'X': {
        // 現在行の選択の追加・解除（Inbox）
        if (!multiSelect || meta || event.altKey) {
          handled = false
          break
        }
        if (activeTask) multiSelect.onChange(toggleSelection(multiSelect.selection, activeTask.id))
        else moveTo(current)
        break
      }
      case 'F2': {
        if (meta || event.altKey) {
          handled = false
          break
        }
        if (activeTask) startEdit(activeTask)
        else moveTo(current)
        break
      }
      case 'e':
      case 'E':
      case 'f':
      case 'F':
      case 'd':
      case 'D':
      case 'm':
      case 'M': {
        // E: 編集モーダル / F: お気に入り / D: 期限のメニュー / M: 紐付けメニュー（現在行がなければ現在行を決めるだけ）
        if (meta || event.altKey) {
          handled = false
          break
        }
        if (!activeTask) {
          moveTo(current)
          break
        }
        const anchor = anchorOf(activeTask)
        if (!anchor) break
        const key = event.key.toLowerCase()
        if (key === 'e') actions.openEditor(activeTask, anchor)
        else if (key === 'f') actions.toggleFavorite(activeTask)
        else if (key === 'd') {
          if (!pendingTaskIds.has(activeTask.id)) actions.openDue(activeTask, anchor)
        } else if (!pendingTaskIds.has(activeTask.id)) (onRequestAssignKey ?? actions.openAssign)(activeTask, anchor)
        break
      }
      case 'Delete':
      case 'Backspace': {
        // 削除（確認なし。現在行がなければ現在行を決めるだけ）
        if (meta || event.altKey) {
          handled = false
          break
        }
        if (activeTask) onRequestDelete(activeTask)
        else moveTo(current)
        break
      }
      case 'ContextMenu':
      case 'F10': {
        // 現在行の「…」メニュー（Shift+F10 か ContextMenu キー）
        if (event.key === 'F10' && !event.shiftKey) {
          handled = false
          break
        }
        if (activeTask) {
          const anchor = anchorOf(activeTask)
          if (anchor) actions.openMenu(activeTask, anchor)
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
    const scroller = section ? externalScroll?.element : scrollRef.current
    const scrollTop = (scroller?.scrollTop ?? 0) - scrollOffset
    const items = virtualizer.getVirtualItems()
    const taskOf = (index: number) => tasks[index]
    const selectedItem = items.find((item) => taskOf(item.index)?.id === selectedTaskId)
    const firstInView = items.find((item) => item.end - scrollOffset > scrollTop)
    const chosen = selectedItem ?? firstInView ?? items[0]
    const target = chosen ? taskOf(chosen.index) : orderedTasks[0]
    if (target) setActiveTaskId(target.id)
  }

  // --- 行のクリック・ドラッグ（Inbox） ---
  const suppressClickRef = useRef(false)
  const pressRef = useRef<{ task: TaskDto; x: number; y: number; cleanup: () => void } | null>(null)
  useEffect(() => () => pressRef.current?.cleanup(), [])

  const handleRowPointerDown = (event: ReactPointerEvent<HTMLElement>, task: TaskDto) => {
    suppressClickRef.current = false
    if (!onRowDragStart || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    pressRef.current?.cleanup()
    const start = { x: event.clientX, y: event.clientY }
    const onMove = (move: PointerEvent) => {
      if (Math.hypot(move.clientX - start.x, move.clientY - start.y) < DRAG_THRESHOLD) return
      cleanup()
      suppressClickRef.current = true
      pendingClick.cancel()
      onRowDragStart(task, { x: move.clientX, y: move.clientY })
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', cleanup)
      window.removeEventListener('pointercancel', cleanup)
      pressRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', cleanup)
    window.addEventListener('pointercancel', cleanup)
    pressRef.current = { task, ...start, cleanup }
  }

  const handleRowClick = (event: ReactMouseEvent<HTMLElement>, task: TaskDto) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    setActiveTaskId(task.id)
    if (multiSelect) {
      if (event.metaKey || event.ctrlKey) {
        multiSelect.onChange(toggleSelection(multiSelect.selection, task.id))
        return
      }
      if (event.shiftKey) {
        multiSelect.onChange(selectRange(multiSelect.selection, task.id, order))
        return
      }
      multiSelect.onChange(selectOnly(task.id))
    }
    onSelect(task.id)
  }

  // タスク名のクリック: シングルは少し待って編集モーダル、ダブルはインライン編集（モーダルを開かない）。
  // 修飾キー付き（Inboxの複数選択）・ドラッグの直後は、行のクリックとして扱う（モーダルを開かない）
  const handleTitleClick = (event: ReactMouseEvent<HTMLElement>, task: TaskDto) => {
    if (suppressClickRef.current) {
      // ドラッグの直後のクリック: 選択もモーダルも行わない
      event.stopPropagation()
      suppressClickRef.current = false
      return
    }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      pendingClick.cancel()
      return
    }
    event.stopPropagation()
    setActiveTaskId(task.id)
    if (event.detail >= 2) {
      startEdit(task)
      return
    }
    const anchor = event.currentTarget
    pendingClick.schedule(anchor, () => {
      if (document.contains(anchor)) actions.openEditor(task, anchor)
      else {
        const row = anchorOf(task)
        if (row) actions.openEditor(task, row)
      }
    })
  }

  // --- 並べ替えのハンドル（カード） ---
  const reorderCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => reorderCleanupRef.current?.(), [])

  const insertIndexAt = (clientY: number) => {
    const scroller = scrollRef.current
    if (!scroller) return 0
    const rect = scroller.getBoundingClientRect()
    const y = clientY - rect.top + scroller.scrollTop
    return Math.max(0, Math.min(tasks.length, Math.round(y / TASK_ROW_HEIGHT)))
  }

  const handleReorderPointerDown = (event: ReactPointerEvent<HTMLElement>, task: TaskDto, index: number) => {
    event.stopPropagation()
    pendingClick.cancel()
    if (!reorder || event.button !== 0 || reorderDrag) return
    event.preventDefault()
    if (reorder.disabledReason) {
      reorder.onBlocked(reorder.disabledReason)
      return
    }
    if (pendingTaskIds.has(task.id) || editingTaskId !== null) return
    setActiveTaskId(task.id)
    let pointerY = event.clientY
    let state = { taskId: task.id, fromIndex: index, insertIndex: index }
    setReorderDrag(state)
    const update = () => {
      const insertIndex = insertIndexAt(pointerY)
      if (insertIndex !== state.insertIndex) {
        state = { ...state, insertIndex }
        setReorderDrag(state)
      }
    }
    let frame = 0
    const tick = () => {
      const scroller = scrollRef.current
      if (scroller) {
        const rect = scroller.getBoundingClientRect()
        const delta = pointerY < rect.top + AUTOSCROLL_EDGE ? -AUTOSCROLL_STEP : pointerY > rect.bottom - AUTOSCROLL_EDGE ? AUTOSCROLL_STEP : 0
        if (delta !== 0) {
          scroller.scrollTop += delta
          update()
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const onMove = (move: PointerEvent) => {
      pointerY = move.clientY
      update()
    }
    const finish = (commit: boolean) => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onCancel)
      reorderCleanupRef.current = null
      setReorderDrag(null)
      if (!commit) return
      // 挿入位置（元の位置より後ろなら、自分を抜いた分を詰める）
      const target = state.insertIndex > state.fromIndex ? state.insertIndex - 1 : state.insertIndex
      moveRow(state.taskId, target)
    }
    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    const onKey = (key: globalThis.KeyboardEvent) => {
      if (key.key !== 'Escape') return
      key.preventDefault()
      key.stopPropagation()
      finish(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('blur', onCancel)
    reorderCleanupRef.current = () => finish(false)
  }

  // aria-activedescendant は描画済みの行だけを参照する（未描画の行はスクロール後の再描画で参照する）
  const virtualItems = virtualizer.getVirtualItems()
  const activeRendered = activeIndex >= 0 && virtualItems.some((item) => item.index === activeIndex)
  const activeTask = activeIndex >= 0 ? orderedTasks[activeIndex] : undefined
  const activeId = activeRendered && activeTask ? taskOptionId(activeTask.id) : undefined

  const selectedIds = multiSelect?.selection.ids
  const fixedHeight =
    section ? tasks.length * TASK_ROW_HEIGHT : maxVisibleRows !== undefined ? Math.max(1, Math.min(maxVisibleRows, tasks.length)) * TASK_ROW_HEIGHT : undefined

  const reorderHandle = (task: TaskDto, index: number) => {
    if (!withHandle || !reorder) return undefined
    const blocked = reorder.disabledReason
    return (
      // マウス用の入口（Tab移動の対象は増やさない。キーボードは一覧で Alt+↑↓）
      <Box
        component="span"
        role="presentation"
        title={blocked ?? (reorder.manual ? 'ドラッグして並べ替え（Alt+↑↓）' : 'ドラッグして並べ替え（並べ替えが「手動順」に切り替わります）')}
        data-reorder-task-id={task.id}
        data-reorder-disabled={blocked ? '' : undefined}
        onPointerDown={(event) => handleReorderPointerDown(event, task, index)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 16,
          height: 30,
          borderRadius: 0.5,
          touchAction: 'none',
          cursor: blocked ? 'not-allowed' : 'grab',
          color: 'text.secondary',
          opacity: blocked ? 0.35 : 0.8,
          '&:hover': { bgcolor: blocked ? 'transparent' : vscodeColors.listHover, opacity: 1 }
        }}
      >
        <GripVertical size={12} aria-hidden />
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: fixedHeight === undefined ? 1 : '0 0 auto' }}>
      {variant === 'table' && sorting && onSort && (
        // 並べ替えの見出し（作成日時は表示しないが、作成日時での並べ替えは残す）
        <Box sx={{ display: 'flex', justifyContent: 'space-between', height: 28, flexShrink: 0, borderBottom: `1px solid ${vscodeColors.border}` }}>
          <SortHeader column="title" label="タイトル" sorting={sorting} onSort={onSort} />
          <SortHeader column="createdAt" label="作成日時" sorting={sorting} onSort={onSort} align="right" />
        </Box>
      )}
      <Box
        ref={scrollRef}
        data-testid="task-list-scroll"
        // 行のドラッグ（Inbox → 紐付け先）中に、上下端で自動スクロールする領域
        data-drag-autoscroll={onRowDragStart ? '' : undefined}
        sx={{
          flex: fixedHeight === undefined ? 1 : '0 0 auto',
          height: fixedHeight,
          minHeight: 0,
          // section は外部のスクロール領域を使う（ここではスクロールしない）
          overflowY: section ? 'visible' : 'auto',
          overflowX: 'hidden'
        }}
      >
        {/* カードでは、タスクが少なくても一覧（フォーカス先）がカードの高さいっぱいに広がるようにする */}
        <Box sx={{ position: 'relative', height: virtualizer.getTotalSize(), minHeight: card ? '100%' : undefined }}>
          <Box
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={listLabel ?? `タスク一覧（${orderedTasks.length}件表示 / 全${totalCount}件）`}
            aria-activedescendant={listFocused ? activeId : undefined}
            aria-multiselectable={multiSelect ? true : undefined}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={() => setListFocused(false)}
            data-testid="task-list"
            data-card-list={cardKey}
            data-variant={variant}
            sx={{
              position: 'absolute',
              inset: 0,
              userSelect: 'none',
              // 現在行があればその行の枠線でフォーカスを示す。空のカードでは一覧全体の枠線で示す
              outline: card && listFocused && activeId === undefined ? `1px solid ${vscodeColors.focusBorder}` : 'none',
              outlineOffset: -1
            }}
          >
            {virtualItems.map((item) => {
              const task = tasks[item.index]
              if (!task) return null
              const selected = selectedIds ? selectedIds.has(task.id) : task.id === selectedTaskId
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  top={item.start - scrollOffset}
                  listId={listId}
                  controlsLayer={controlsLayer}
                  today={today}
                  actions={actions}
                  selected={selected}
                  active={listFocused && item.index === activeIndex}
                  pending={pendingTaskIds.has(task.id)}
                  dimmed={reorderDrag?.taskId === task.id}
                  handle={reorderHandle(task, item.index)}
                  onRowPointerDown={(event) => handleRowPointerDown(event, task)}
                  onRowClick={(event) => handleRowClick(event, task)}
                  onRowContextMenu={(event) => {
                    // 右クリック: 行の「…」メニュー（選択・詳細パネルは変えない）
                    event.preventDefault()
                    pendingClick.cancel()
                    setActiveTaskId(task.id)
                    actions.openMenu(task, event.currentTarget)
                  }}
                  onTitleClick={(event) => handleTitleClick(event, task)}
                  onTitleDoubleClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
                    event.stopPropagation()
                    startEdit(task)
                  }}
                  onInlineDone={focusList}
                />
              )
            })}
          </Box>
          {/* listbox の外側の重ね合わせ層: 各 TaskRow の操作ボタン・並べ替えのハンドル・インライン編集（option の中に操作要素を置かない）と、空のカードの表示 */}
          <Box ref={setControlsLayer} sx={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} data-testid="task-list-overlay">
            {tasks.length === 0 && emptyLabel && (
              <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 2, py: 1.5, m: 0 }} aria-hidden>
                {emptyLabel}
              </Typography>
            )}
            {reorderDrag && (
              // 挿入位置の線
              <Box
                data-testid="reorder-indicator"
                data-insert-index={reorderDrag.insertIndex}
                sx={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  height: 2,
                  top: reorderDrag.insertIndex * TASK_ROW_HEIGHT - 1,
                  bgcolor: vscodeColors.focusBorder
                }}
              />
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
