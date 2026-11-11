import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Alert, Box, IconButton, Menu, MenuItem, Tooltip, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'
import { GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { MILESTONE_NAME_MAX_LENGTH, type MilestoneDeletionSummary } from '../../../../shared/contracts/milestones'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import { TASK_TITLE_MAX_LENGTH, type TaskDto } from '../../../../shared/contracts/tasks'
import { clampWidth, WORKSPACE_LIMITS, type MilestoneLayout } from '../../../../shared/contracts/workspace'
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog'
import { InlineCreate } from '../../components/InlineCreate'
import { IpcCallError } from '../../lib/ipc'
import { vscodeColors } from '../../theme'
import { useDraftGuard, type DraftTarget } from '../drafts/DraftGuard'
import type { TaskGroup } from '../tasks/assignment'
import { taskListQueryOptions, useCreateTaskMutation, useReorderMilestoneTasksMutation } from '../tasks/task-queries'
import type { TaskSortColumn } from '../tasks/task-table'
import type { TaskRowActions } from '../tasks/TaskRow'
import { TaskList } from '../tasks/TaskList'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { MilestoneNameEditor } from './MilestoneForms'
import {
  fetchMilestoneDeletionSummary,
  milestoneListQueryOptions,
  useCreateMilestoneMutation,
  useDeleteMilestoneMutation,
  useReorderMilestonesMutation
} from './milestone-queries'

const LIMITS = WORKSPACE_LIMITS.milestoneCardWidth
// キーボードでの幅変更の刻み（Shift 併用で大きく動かす）
const KEY_STEP = 16
const KEY_STEP_LARGE = 64

// カードの幅変更のハンドル（各カードの右端）。どのハンドルを操作しても、全カードの共通の幅が変わる。
// - ドラッグ中は onPreview で画面へ即時反映し、保存しない。ドラッグを終えた時に1回だけ onCommit（保存）する。
// - pointer capture でカードの外へ出ても操作を続ける。キャンセル（pointercancel・Esc・capture の喪失）では元の幅へ戻し、保存しない。
// - キーボード: ←→ で ±16px（Shift で ±64px）、Home で最小、End で最大。押すたびに保存する。
// - 一覧（listbox）の外にあり、操作がタスクの選択・完了の切り替えへ伝わらないようにする。
function CardResizeHandle({
  width,
  onPreview,
  onCommit
}: {
  width: number
  onPreview: (width: number | null) => void
  onCommit: (width: number) => void
}) {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number; element: HTMLElement } | null>(null)
  const onPreviewRef = useRef(onPreview)
  onPreviewRef.current = onPreview

  const widthAt = (clientX: number) => {
    const drag = dragRef.current
    return drag ? clampWidth(drag.startWidth + (clientX - drag.startX), LIMITS) : width
  }

  const endDrag = (commitWidth: number | null) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
    if (commitWidth !== null) onCommit(commitWidth)
    onPreviewRef.current(null)
  }

  // ドラッグ中にアンマウントされたら、capture を解放して途中の幅を捨てる（保存しない）
  useEffect(
    () => () => {
      const drag = dragRef.current
      dragRef.current = null
      if (!drag) return
      if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId)
      onPreviewRef.current(null)
    },
    []
  )

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || dragRef.current) return
    event.preventDefault()
    event.stopPropagation()
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    element.focus()
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width, element }
    onPreview(width)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && dragRef.current) {
      event.preventDefault()
      endDrag(null)
      return
    }
    if (dragRef.current) return
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP
    let next: number | null = null
    if (event.key === 'ArrowLeft') next = width - step
    else if (event.key === 'ArrowRight') next = width + step
    else if (event.key === 'Home') next = LIMITS.min
    else if (event.key === 'End') next = LIMITS.max
    if (next === null) return
    event.preventDefault()
    event.stopPropagation()
    onCommit(clampWidth(next, LIMITS))
  }

  return (
    <Box
      role="separator"
      aria-orientation="vertical"
      aria-label="カードの幅（すべてのカードに共通）"
      aria-valuenow={width}
      aria-valuemin={LIMITS.min}
      aria-valuemax={LIMITS.max}
      aria-valuetext={`${width}px`}
      tabIndex={0}
      data-testid="card-resize-handle"
      onPointerDown={handlePointerDown}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        onPreview(widthAt(event.clientX))
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current
        if (!drag || drag.pointerId !== event.pointerId) return
        endDrag(widthAt(event.clientX))
      }}
      onPointerCancel={() => endDrag(null)}
      onLostPointerCapture={() => endDrag(null)}
      onKeyDown={handleKeyDown}
      onClick={(event) => event.stopPropagation()}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        right: -6,
        width: 9,
        zIndex: 1,
        cursor: 'col-resize',
        touchAction: 'none',
        userSelect: 'none',
        outline: 'none',
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 4,
          width: '1px',
          bgcolor: 'transparent'
        },
        '&:hover::after, &:focus-visible::after': { bgcolor: vscodeColors.focusBorder },
        '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${vscodeColors.focusBorder}` }
      }}
    />
  )
}

const isScopeChanged = (error: unknown) => error instanceof IpcCallError && error.details?.kind === 'deletion-scope-changed'
const SCOPE_CHANGED_NOTICE = '確認した後に所属するタスクの件数が変わりました。内容を確認して、もう一度削除してください。'

// マイルストンの削除の流れ（フェーズ5.6）。カードの見出しのメニューから使う。
// 1. 進行中の保存（保存キュー・編集欄）を待ち、DBで数えた件数（完了済み・検索で隠れているタスクを含む）を取得する。
// 2. 0件なら確認なしで削除する。1件以上なら、名前・件数・「タスクは削除されず、画面に表示されなくなる」ことを示して確認する。
// 3. 削除時は確認した件数を添える。件数が変わっていたら（Mainが拒否）、確認内容を取り直して再確認する（削除範囲を無断で広げない）。
// 4. 成功したら、対象のマイルストン名・所属タスクの未保存の編集だけを破棄し、選択中のタスクが所属していれば選択を解除する。
//    失敗・キャンセルでは何も変えない（理由を表示する）。
function useMilestoneDeletion(onAnnounce: (message: string) => void) {
  const { settle, hasDirty, discard } = useDraftGuard()
  const { selectedTaskId, selectTask } = useWorkspace()
  const tasksQuery = useQuery(taskListQueryOptions)
  const deleteMilestone = useDeleteMilestoneMutation()
  const [dialog, setDialog] = useState<{ summary: MilestoneDeletionSummary; draftDirty: boolean; notice: string | null } | null>(null)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [preparingId, setPreparingId] = useState<string | null>(null)
  const busyRef = useRef(false)
  const latest = useRef({ tasks: tasksQuery.data, selectedTaskId })
  latest.current = { tasks: tasksQuery.data, selectedTaskId }

  // 対象のマイルストンと、その所属タスク（画面のキャッシュ上）の編集
  const related = (milestoneId: string) => {
    const taskIds = new Set((latest.current.tasks ?? []).filter((task) => task.milestoneId === milestoneId).map((task) => task.id))
    return {
      taskIds,
      match: (target: DraftTarget) => (target.kind === 'milestone' && target.id === milestoneId) || (target.kind === 'task' && taskIds.has(target.id))
    }
  }

  const openDialog = (summary: MilestoneDeletionSummary, notice: string | null) => {
    deleteMilestone.reset()
    setDialog({ summary, draftDirty: hasDirty(related(summary.id).match), notice })
  }

  const run = async (summary: MilestoneDeletionSummary): Promise<void> => {
    const { taskIds, match } = related(summary.id)
    try {
      const result = await deleteMilestone.mutateAsync({ id: summary.id, expectedTaskCount: summary.taskCount })
      discard(match)
      if (latest.current.selectedTaskId && taskIds.has(latest.current.selectedTaskId)) selectTask(null)
      setDialog(null)
      onAnnounce(
        result.hiddenTaskCount > 0
          ? `マイルストン「${summary.name}」を削除しました（タスク ${result.hiddenTaskCount} 件は表示されなくなりました）`
          : `マイルストン「${summary.name}」を削除しました`
      )
    } catch (error) {
      if (!isScopeChanged(error)) {
        // 確認ダイアログを出していない（空のマイルストン）場合は、カードの列の上に理由を出す
        if (summary.taskCount === 0) setBoardError(`マイルストンを削除できませんでした: ${(error as Error).message}`)
        return
      }
      // 件数が変わった: 取り直して再確認する
      try {
        openDialog(await fetchMilestoneDeletionSummary(summary.id), SCOPE_CHANGED_NOTICE)
      } catch (fetchError) {
        setDialog(null)
        setBoardError(`マイルストンを削除できませんでした: ${(fetchError as Error).message}`)
      }
    }
  }

  const request = async (milestoneId: string) => {
    if (busyRef.current || dialog) return
    busyRef.current = true
    setPreparingId(milestoneId)
    setBoardError(null)
    try {
      await settle()
      const summary = await fetchMilestoneDeletionSummary(milestoneId)
      if (summary.taskCount === 0) await run(summary)
      else openDialog(summary, null)
    } catch (error) {
      setBoardError(`マイルストンを削除できませんでした: ${(error as Error).message}`)
    } finally {
      busyRef.current = false
      setPreparingId(null)
    }
  }

  const confirm = async () => {
    if (!dialog || busyRef.current) return
    busyRef.current = true
    try {
      await run(dialog.summary)
    } finally {
      busyRef.current = false
    }
  }

  const error = deleteMilestone.error && !isScopeChanged(deleteMilestone.error) ? `削除できませんでした: ${deleteMilestone.error.message}` : null

  const element = (
    <ConfirmDeleteDialog
      open={dialog !== null}
      title="マイルストンを削除しますか？"
      confirmLabel="マイルストンを削除"
      pending={deleteMilestone.isPending}
      error={error}
      notice={dialog?.notice ?? null}
      onConfirm={() => void confirm()}
      onCancel={() => {
        if (deleteMilestone.isPending) return
        setDialog(null)
        deleteMilestone.reset()
      }}
      testId="milestone-delete-dialog"
    >
      {dialog && (
        <>
          <Typography sx={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }} data-testid="milestone-delete-dialog-target">
            「{dialog.summary.name}」
          </Typography>
          <Typography sx={{ fontSize: 13, mt: 1 }} data-testid="milestone-delete-dialog-count">
            所属するタスク: {dialog.summary.taskCount} 件（完了済み・絞り込みで表示していないタスクを含む）
          </Typography>
          <Typography sx={{ fontSize: 13, mt: 1 }}>
            タスクは削除されず、画面に表示されなくなります（Inbox にも表示しません）。マイルストンは削除され、元に戻せません。
          </Typography>
          {dialog.draftDirty && (
            <Typography sx={{ fontSize: 13, mt: 1, color: 'warning.light' }} data-testid="milestone-delete-dialog-draft">
              このマイルストン・所属タスクの未保存の変更も失われます。
            </Typography>
          )}
        </>
      )}
    </ConfirmDeleteDialog>
  )

  return {
    request: (milestoneId: string) => void request(milestoneId),
    busyId: preparingId ?? (deleteMilestone.isPending ? deleteMilestone.variables?.id ?? null : null),
    boardError,
    clearBoardError: () => setBoardError(null),
    dialog: element
  }
}

// カードの見出しのメニュー（名前を変更・削除。フェーズ5.6）
function CardMenu({
  label,
  milestoneId,
  disabled,
  onRename,
  onDelete
}: {
  label: string
  milestoneId: string
  disabled: boolean
  onRename: () => void
  onDelete: () => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <Tooltip title="マイルストンのメニュー">
        <span>
          <IconButton
            aria-label={`マイルストン「${label}」のメニュー`}
            aria-haspopup="menu"
            aria-expanded={anchor !== null}
            disabled={disabled}
            data-milestone-menu={milestoneId}
            onClick={(event) => setAnchor(event.currentTarget)}
            sx={{ color: 'text.secondary', flexShrink: 0 }}
          >
            <MoreHorizontal size={14} aria-hidden />
          </IconButton>
        </span>
      </Tooltip>
      <Menu
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { 'aria-label': `マイルストン「${label}」のメニュー`, dense: true } }}
        data-testid="milestone-menu"
      >
        <MenuItem
          autoFocus
          onClick={() => {
            setAnchor(null)
            onRename()
          }}
          sx={{ fontSize: 13, gap: 1 }}
          data-testid="milestone-menu-rename"
        >
          <Pencil size={14} aria-hidden />
          名前を変更
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchor(null)
            onDelete()
          }}
          sx={{ fontSize: 13, gap: 1, color: 'error.light' }}
          data-testid="milestone-menu-delete"
        >
          <Trash2 size={14} aria-hidden />
          マイルストンを削除…
        </MenuItem>
      </Menu>
    </>
  )
}

// カードの並べ替えのハンドル（フェーズ5.9。カードの見出しの左端）。
// - ドラッグ: column は左右、row は上下に動かし、離した位置へ移す（Esc・ポインターの取り消しでは保存しない）。
//   カードの列の端に近づくと、列を自動でスクロールする。
// - キーボード: ←↑ で前へ、→↓ で後ろへ、Home で先頭、End で末尾（押すたびに保存する）。
// - NEW MILESTONE は並べ替えの対象にしない（常に末尾）。幅のハンドル・名前の編集・メニューとは別の要素。
function CardMoveHandle({
  label,
  milestoneId,
  layout,
  disabled,
  onKeyMove,
  onDragStart
}: {
  label: string
  milestoneId: string
  layout: MilestoneLayout
  disabled: boolean
  onKeyMove: (target: 'prev' | 'next' | 'first' | 'last') => void
  onDragStart: (event: PointerEvent<HTMLButtonElement>) => void
}) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const map: Record<string, 'prev' | 'next' | 'first' | 'last'> = {
      ArrowLeft: 'prev',
      ArrowUp: 'prev',
      ArrowRight: 'next',
      ArrowDown: 'next',
      Home: 'first',
      End: 'last'
    }
    const target = map[event.key]
    if (!target || event.metaKey || event.ctrlKey || event.altKey) return
    event.preventDefault()
    event.stopPropagation()
    if (!disabled) onKeyMove(target)
  }
  const keys = layout === 'column' ? '← →' : '↑ ↓'
  return (
    <Tooltip title={`ドラッグ、または ${keys} キーでカードを移動`}>
      <IconButton
        aria-label={`マイルストン「${label}」を移動（${keys} キー・Home・End）`}
        aria-roledescription="並べ替えハンドル"
        aria-disabled={disabled || undefined}
        data-card-move={milestoneId}
        onKeyDown={handleKeyDown}
        onPointerDown={(event) => {
          if (!disabled) onDragStart(event)
        }}
        sx={{ color: 'text.secondary', flexShrink: 0, cursor: disabled ? 'default' : 'grab', touchAction: 'none', ml: -0.5 }}
      >
        <GripVertical size={14} aria-hidden />
      </IconButton>
    </Tooltip>
  )
}

// row レイアウトでカードに表示する最大の行数（それ以上はカードの中でスクロールする。仮想化は維持する）
const ROW_LAYOUT_VISIBLE_ROWS = 8
const BOARD_AUTOSCROLL_EDGE = 40
const BOARD_AUTOSCROLL_STEP = 16

// カード内のタスクの並べ替えの設定（フェーズ5.9。TaskScopeView から）
export type TaskReorderSettings = {
  disabledReason: string | null
  manual: boolean
  onSwitchToManual: () => void
}

// プロジェクト画面のマイルストン別カード（フェーズ5.5）。
// - マイルストン1件につきカード1枚（手動順 → 作成順。フェーズ5.9）、その後に NEW MILESTONE（常に末尾。並べ替えの対象外）。
//   マイルストンが0件なら、カード列の先頭に NEW MILESTONE だけを表示する。
// - 見出しのメニュー（…）から名前の変更・マイルストンの削除（フェーズ5.6）。見出しの左端のハンドルでカードの並べ替え（フェーズ5.9）。
// - レイアウト（フェーズ5.9。トップバーで切り替え・保存）:
//   column: 縦長のカードを横に並べ、収まらない分はカードの列だけを横スクロールする。カードの高さは利用できる高さに合わせる。
//   row: カードを上から下へ並べ、各カードはメイン領域の横幅を使う。カードの列は縦スクロール。カードの高さは最大8行分で、
//   それ以上はカードの中でスクロールする（全タスクを描画しない。仮想化は維持する）。幅のハンドルは表示しない（保存済みの幅は保持する）。
// - カードごとに別の仮想リスト（大量タスクでも全件は描画しない）。
// - 検索・状態・ソートは全カード共通（groups は絞り込み・ソート済み）。絞り込みで0件になってもカードは残す。
// - 幅は全カード共通・アプリ全体の設定（Workspace設定の milestoneCardWidth）。ウィンドウが狭くても保存値は書き換えない。
// - カード内のタスクの並べ替え（フェーズ5.9）: 行の先頭のハンドル（ドラッグ）か Alt+↑↓。同じマイルストンの中だけ。
//   絞り込み中は無効（理由を示す）。手動順以外の並べ替えで行うと、保存後に手動順へ切り替える（その旨を示す）。
// - キーボード: Tab で各カードの見出しの操作・一覧・NEW TASK・幅のハンドル・NEW MILESTONE へ。一覧の中では ← → で隣のカードへ。
export function MilestoneBoard({
  project,
  groups,
  layout,
  selectedTaskId,
  pendingTaskIds,
  sorting,
  resetScrollKey,
  onSort,
  onSelect,
  actions,
  onRequestDelete,
  onAnnounce,
  taskReorder
}: {
  project: ProjectDto
  groups: readonly TaskGroup[]
  layout: MilestoneLayout
  selectedTaskId: string | null
  pendingTaskIds: ReadonlySet<string>
  sorting: SortingState
  resetScrollKey: string
  onSort: (column: TaskSortColumn) => void
  onSelect: (taskId: string) => void
  // 行内の操作（TaskRow。3画面で共通の useTaskRowActions）
  actions: TaskRowActions
  // Delete キーの削除（確認なし。フェーズ5.9）
  onRequestDelete: (task: TaskDto) => void
  onAnnounce: (message: string) => void
  taskReorder: TaskReorderSettings
}) {
  const { settings, setMilestoneCardWidth } = useWorkspace()
  const deletion = useMilestoneDeletion(onAnnounce)
  // ドラッグ中だけの幅（保存しない）。null なら保存済みの共通の幅
  const [previewWidth, setPreviewWidth] = useState<number | null>(null)
  const width = previewWidth ?? settings.milestoneCardWidth
  const { confirmLeave } = useDraftGuard()
  const milestones = useQuery(milestoneListQueryOptions)
  // 名前を編集中のマイルストン（カードの見出しの「名前を変更」で開く）。表示中のプロジェクトのものだけ
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null)
  const editingMilestone = milestones.data?.find((item) => item.id === editingMilestoneId && item.projectId === project.id)
  const createTask = useCreateTaskMutation()
  const createMilestone = useCreateMilestoneMutation()
  const reorderMilestones = useReorderMilestonesMutation()
  const reorderTasks = useReorderMilestoneTasksMutation()
  const [orderError, setOrderError] = useState<string | null>(null)
  const [reorderNotice, setReorderNotice] = useState<string | null>(null)
  const boardRef = useRef<HTMLDivElement>(null)
  const completed = project.completedAt !== null
  const disabledReason = completed ? `「${project.name}」は完了済みのため、追加できません。` : undefined
  const row = layout === 'row'
  // カードのドラッグ中の状態（挿入位置 0..カード数）
  const [cardDrag, setCardDrag] = useState<{ milestoneId: string; fromIndex: number; insertIndex: number } | null>(null)
  const cardDragCleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cardDragCleanupRef.current?.(), [])

  const openMilestoneEditor = async (milestoneId: string) => {
    if (milestoneId === editingMilestoneId) return
    // 別の編集（マイルストン名・プロジェクト名・タスクのタイトル）が未保存なら、先に既存の確認を行う
    if (!(await confirmLeave())) return
    setEditingMilestoneId(milestoneId)
  }

  // マイルストンが0件になったら（最後のマイルストンの削除を含む）、カード列を先頭までスクロールし、NEW MILESTONE を最初から見せる
  const empty = groups.length === 0
  useEffect(() => {
    if (empty && boardRef.current) {
      boardRef.current.scrollLeft = 0
      boardRef.current.scrollTop = 0
    }
  }, [empty])

  const focusCard = (index: number) => {
    const group = groups[index]
    if (!group) return
    boardRef.current?.querySelector<HTMLElement>(`[data-card-list="${CSS.escape(group.key)}"]`)?.focus()
  }

  // --- カードの並べ替え（フェーズ5.9） ---
  const saveCardOrder = (milestoneId: string, toIndex: number) => {
    const ids = groups.map((group) => group.milestoneId)
    const from = ids.indexOf(milestoneId)
    const target = Math.max(0, Math.min(ids.length - 1, toIndex))
    if (from < 0 || from === target || reorderMilestones.isPending) return
    ids.splice(from, 1)
    ids.splice(target, 0, milestoneId)
    setOrderError(null)
    const name = groups[from]?.label ?? ''
    reorderMilestones.mutate(
      { projectId: project.id, orderedIds: ids },
      {
        onSuccess: () => {
          onAnnounce(`マイルストン「${name}」を ${target + 1} 番目へ移動しました`)
          // キーボードで移動した場合は、移動後のカードのハンドルにフォーカスを残す
          requestAnimationFrame(() => {
            if (document.activeElement === document.body || document.activeElement?.closest('[data-card-move]')) {
              boardRef.current?.querySelector<HTMLElement>(`[data-card-move="${CSS.escape(milestoneId)}"]`)?.focus()
            }
          })
        },
        onError: (error) => setOrderError(`カードの順序を保存できませんでした: ${error.message}`)
      }
    )
  }

  const moveCardByKey = (milestoneId: string, target: 'prev' | 'next' | 'first' | 'last') => {
    const from = groups.findIndex((group) => group.milestoneId === milestoneId)
    if (from < 0) return
    const to = target === 'prev' ? from - 1 : target === 'next' ? from + 1 : target === 'first' ? 0 : groups.length - 1
    saveCardOrder(milestoneId, to)
  }

  const cardInsertIndexAt = (clientX: number, clientY: number) => {
    const cards = [...(boardRef.current?.querySelectorAll<HTMLElement>('[data-testid=milestone-card]') ?? [])]
    let index = 0
    for (const card of cards) {
      const rect = card.getBoundingClientRect()
      const middle = row ? rect.top + rect.height / 2 : rect.left + rect.width / 2
      if ((row ? clientY : clientX) > middle) index++
    }
    return index
  }

  const startCardDrag = (event: PointerEvent<HTMLButtonElement>, milestoneId: string, fromIndex: number) => {
    if (event.button !== 0 || cardDrag || reorderMilestones.isPending) return
    event.preventDefault()
    event.stopPropagation()
    let point = { x: event.clientX, y: event.clientY }
    let state = { milestoneId, fromIndex, insertIndex: fromIndex }
    setCardDrag(state)
    const update = () => {
      const insertIndex = cardInsertIndexAt(point.x, point.y)
      if (insertIndex !== state.insertIndex) {
        state = { ...state, insertIndex }
        setCardDrag(state)
      }
    }
    let frame = 0
    const tick = () => {
      const board = boardRef.current
      if (board) {
        const rect = board.getBoundingClientRect()
        const position = row ? point.y : point.x
        const start = row ? rect.top : rect.left
        const end = row ? rect.bottom : rect.right
        const delta = position < start + BOARD_AUTOSCROLL_EDGE ? -BOARD_AUTOSCROLL_STEP : position > end - BOARD_AUTOSCROLL_EDGE ? BOARD_AUTOSCROLL_STEP : 0
        if (delta !== 0) {
          if (row) board.scrollTop += delta
          else board.scrollLeft += delta
          update()
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const onMove = (move: globalThis.PointerEvent) => {
      point = { x: move.clientX, y: move.clientY }
      update()
    }
    const finish = (commit: boolean) => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', onCancel)
      cardDragCleanupRef.current = null
      setCardDrag(null)
      if (!commit) return
      const target = state.insertIndex > state.fromIndex ? state.insertIndex - 1 : state.insertIndex
      saveCardOrder(state.milestoneId, target)
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
    cardDragCleanupRef.current = () => finish(false)
  }

  // --- カード内のタスクの並べ替え（フェーズ5.9） ---
  const moveTasks = (milestoneId: string, orderedIds: string[], movedTaskId: string) => {
    if (reorderTasks.isPending) return
    setOrderError(null)
    const switching = !taskReorder.manual
    if (switching) setReorderNotice('並べ替えを保存すると、表示順は「手動順」に切り替わります。')
    reorderTasks.mutate(
      { milestoneId, orderedIds },
      {
        onSuccess: () => {
          if (switching) {
            taskReorder.onSwitchToManual()
            setReorderNotice('並べ替えを「手動順」に切り替えました。')
          }
          const position = orderedIds.indexOf(movedTaskId) + 1
          onAnnounce(`タスクを ${position} 番目へ移動しました${switching ? '（並べ替え: 手動順）' : ''}`)
        },
        onError: (error) => {
          if (switching) setReorderNotice(null)
          setOrderError(`タスクの順序を保存できませんでした: ${error.message}`)
        }
      }
    )
  }

  const insertBefore = cardDrag ? cardDrag.insertIndex : -1

  return (
    <>
      {deletion.boardError && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2, flexShrink: 0 }} onClose={deletion.clearBoardError} data-testid="milestone-delete-error">
          {deletion.boardError}
        </Alert>
      )}
      {orderError && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2, flexShrink: 0 }} onClose={() => setOrderError(null)} data-testid="order-error">
          {orderError}
        </Alert>
      )}
      {reorderNotice && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2, py: 0, flexShrink: 0 }} onClose={() => setReorderNotice(null)} data-testid="reorder-notice">
          {reorderNotice}
        </Alert>
      )}
      {deletion.dialog}
      <Box
        ref={boardRef}
        role="group"
        aria-label="マイルストン別のタスク"
        data-testid="milestone-board"
        data-layout={layout}
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: row ? 'column' : 'row',
          alignItems: 'stretch',
          gap: 3,
          overflowX: row ? 'hidden' : 'auto',
          overflowY: row ? 'auto' : 'hidden',
          pb: 1,
          pr: 2
        }}
      >
        {groups.map((group, index) => {
          const editing = editingMilestone?.id === group.milestoneId
          const cardName = `マイルストン「${group.label}」`
          const deleting = deletion.busyId === group.milestoneId
          const dragged = cardDrag?.milestoneId === group.milestoneId
          // 挿入位置の線（このカードの前、最後のカードの後）
          const lineBefore = insertBefore === index && cardDrag !== null
          const lineAfter = insertBefore === groups.length && index === groups.length - 1 && cardDrag !== null
          const lineColor = vscodeColors.focusBorder
          const insertShadow = lineBefore
            ? row
              ? `0 -3px 0 0 ${lineColor}`
              : `-3px 0 0 0 ${lineColor}`
            : lineAfter
              ? row
                ? `0 3px 0 0 ${lineColor}`
                : `3px 0 0 0 ${lineColor}`
              : 'none'
          return (
            <Box
              key={group.key}
              component="section"
              aria-label={cardName}
              data-testid="milestone-card"
              data-card-key={group.key}
              data-milestone-id={group.milestoneId}
              data-insert-before={lineBefore || undefined}
              data-insert-after={lineAfter || undefined}
              aria-busy={deleting}
              sx={{
                flex: '0 0 auto',
                width: row ? '100%' : width,
                minHeight: 0,
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                bgcolor: vscodeColors.sideBarBackground,
                border: `1px solid ${vscodeColors.border}`,
                borderRadius: 1,
                opacity: dragged ? 0.6 : 1,
                boxShadow: insertShadow
              }}
            >
              <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${vscodeColors.border}`, flexShrink: 0 }}>
                {editing && editingMilestone ? (
                  <MilestoneNameEditor key={editingMilestone.id} milestone={editingMilestone} onClose={() => setEditingMilestoneId(null)} />
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28 }}>
                    <CardMoveHandle
                      label={group.label}
                      milestoneId={group.milestoneId}
                      layout={layout}
                      disabled={deleting || reorderMilestones.isPending}
                      onKeyMove={(target) => moveCardByKey(group.milestoneId, target)}
                      onDragStart={(event) => startCardDrag(event, group.milestoneId, index)}
                    />
                    <Typography
                      component="h2"
                      noWrap
                      title={group.label}
                      sx={{ fontSize: 13, fontWeight: 600, m: 0, minWidth: 0, color: 'text.primary' }}
                      data-testid="group-label"
                    >
                      {group.label}
                    </Typography>
                    <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0 }} data-testid="card-count">
                      {group.tasks.length} 件
                    </Typography>
                    {deleting && (
                      <Typography component="span" role="status" sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0 }}>
                        削除中…
                      </Typography>
                    )}
                    <Tooltip title="名前を変更">
                      <IconButton
                        aria-label={`マイルストン「${group.label}」の名前を変更`}
                        data-rename-milestone={group.milestoneId}
                        disabled={deleting}
                        onClick={() => void openMilestoneEditor(group.milestoneId)}
                        sx={{ ml: 'auto', color: 'text.secondary', flexShrink: 0 }}
                      >
                        <Pencil size={13} aria-hidden />
                      </IconButton>
                    </Tooltip>
                    <CardMenu
                      label={group.label}
                      milestoneId={group.milestoneId}
                      disabled={deleting}
                      onRename={() => void openMilestoneEditor(group.milestoneId)}
                      onDelete={() => deletion.request(group.milestoneId)}
                    />
                  </Box>
                )}
              </Box>
              <TaskList
                variant="card"
                cardKey={group.key}
                listLabel={`${cardName}のタスク（${group.tasks.length}件）`}
                emptyLabel="タスクはありません"
                tasks={group.tasks}
                totalCount={group.tasks.length}
                maxVisibleRows={row ? ROW_LAYOUT_VISIBLE_ROWS : undefined}
                selectedTaskId={selectedTaskId}
                pendingTaskIds={pendingTaskIds}
                sorting={sorting}
                resetScrollKey={resetScrollKey}
                onSort={onSort}
                onSelect={onSelect}
                onNavigateCard={(direction) => focusCard(index + direction)}
                actions={actions}
                onRequestDelete={onRequestDelete}
                reorder={{
                  disabledReason: taskReorder.disabledReason,
                  manual: taskReorder.manual,
                  onMove: (orderedIds, movedTaskId) => moveTasks(group.milestoneId, orderedIds, movedTaskId),
                  onBlocked: (reason) => {
                    setReorderNotice(reason)
                    onAnnounce(reason)
                  }
                }}
              />
              <Box sx={{ px: 1, py: 1, borderTop: `1px solid ${vscodeColors.border}`, flexShrink: 0 }}>
                {/* 登録先はこのカードに固定する（projectId と、このカードのマイルストンの milestoneId） */}
                <InlineCreate
                  buttonLabel="NEW TASK"
                  inputLabel={`${cardName}に追加するタスクのタイトル`}
                  placeholder="タスクのタイトル"
                  maxLength={TASK_TITLE_MAX_LENGTH}
                  disabledReason={disabledReason}
                  keepOpenAfterCreate
                  testId={`new-task-${group.milestoneId}`}
                  onCreate={(title) => createTask.mutateAsync({ title, projectId: project.id, milestoneId: group.milestoneId })}
                />
              </Box>
              {/* 幅のハンドルは column だけ（row ではカードがメイン領域の横幅を使う。保存済みの幅は保持する） */}
              {!row && <CardResizeHandle width={width} onPreview={setPreviewWidth} onCommit={setMilestoneCardWidth} />}
            </Box>
          )
        })}
        {/* NEW MILESTONE は常に末尾（並べ替えの対象外） */}
        <Box sx={{ flex: '0 0 auto', width: 220, pt: row ? 0 : 0.5 }}>
          <InlineCreate
            buttonLabel="NEW MILESTONE"
            inputLabel="新しいマイルストンの名前"
            placeholder="マイルストンの名前"
            maxLength={MILESTONE_NAME_MAX_LENGTH}
            disabledReason={disabledReason}
            testId="new-milestone"
            onCreate={(name) => createMilestone.mutateAsync({ projectId: project.id, name })}
          />
        </Box>
      </Box>
    </>
  )
}
