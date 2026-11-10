import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'
import { Pencil } from 'lucide-react'
import { MILESTONE_NAME_MAX_LENGTH } from '../../../../shared/contracts/milestones'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import { TASK_TITLE_MAX_LENGTH, type TaskDto } from '../../../../shared/contracts/tasks'
import { clampWidth, WORKSPACE_LIMITS } from '../../../../shared/contracts/workspace'
import { InlineCreate } from '../../components/InlineCreate'
import { vscodeColors } from '../../theme'
import { useDraftGuard } from '../drafts/DraftGuard'
import type { TaskGroup } from '../tasks/assignment'
import { useCreateTaskMutation } from '../tasks/task-queries'
import type { TaskSortColumn } from '../tasks/task-table'
import { TaskList } from '../tasks/TaskList'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { MilestoneNameEditor } from './MilestoneForms'
import { milestoneListQueryOptions, useCreateMilestoneMutation } from './milestone-queries'

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

// プロジェクト画面のマイルストン別カード（フェーズ5.5）。
// - マイルストン1件につき縦長のカード1枚（マイルストンの作成順）、最後に「マイルストン未設定」、その後に NEW MILESTONE。
// - カードはメイン領域の中で横に並べ、収まらない分はカードの列だけを横スクロールする（ウィンドウ・左右のペインは横スクロールさせない）。
// - カードの高さは利用できる高さに合わせ、タスクはカードの中で縦スクロールする。カードごとに別の仮想リスト（大量タスクでも全件は描画しない）。
// - 検索・状態・ソートは全カード共通（groups は絞り込み・ソート済み）。絞り込みで0件になってもカードは残す。
// - 幅は全カード共通・アプリ全体の設定（Workspace設定の milestoneCardWidth）。ウィンドウが狭くても保存値は書き換えない。
// - キーボード: Tab で各カードの見出しの操作・一覧・NEW TASK・幅のハンドル・NEW MILESTONE へ。一覧の中では ← → で隣のカードへ。
export function MilestoneBoard({
  project,
  groups,
  selectedTaskId,
  pendingTaskIds,
  sorting,
  resetScrollKey,
  onSort,
  onSelect,
  onToggleCompleted
}: {
  project: ProjectDto
  groups: readonly TaskGroup[]
  selectedTaskId: string | null
  pendingTaskIds: ReadonlySet<string>
  sorting: SortingState
  resetScrollKey: string
  onSort: (column: TaskSortColumn) => void
  onSelect: (taskId: string) => void
  onToggleCompleted: (task: TaskDto) => void
}) {
  const { settings, setMilestoneCardWidth } = useWorkspace()
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
  const boardRef = useRef<HTMLDivElement>(null)
  const completed = project.completedAt !== null
  const disabledReason = completed ? `「${project.name}」は完了済みのため、追加できません。` : undefined

  const openMilestoneEditor = async (milestoneId: string) => {
    if (milestoneId === editingMilestoneId) return
    // 別の編集（マイルストン名・プロジェクト名・タスクのタイトル）が未保存なら、先に既存の確認を行う
    if (!(await confirmLeave())) return
    setEditingMilestoneId(milestoneId)
  }

  const focusCard = (index: number) => {
    const group = groups[index]
    if (!group) return
    boardRef.current?.querySelector<HTMLElement>(`[data-card-list="${CSS.escape(group.key)}"]`)?.focus()
  }

  return (
    <Box
      ref={boardRef}
      role="group"
      aria-label="マイルストン別のタスク"
      data-testid="milestone-board"
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        alignItems: 'stretch',
        gap: 3,
        overflowX: 'auto',
        overflowY: 'hidden',
        pb: 1,
        pr: 2
      }}
    >
      {groups.map((group, index) => {
        const editing = group.milestoneId !== null && editingMilestone?.id === group.milestoneId
        const cardName = group.milestoneId === null ? 'マイルストン未設定' : `マイルストン「${group.label}」`
        return (
          <Box
            key={group.key}
            component="section"
            aria-label={cardName}
            data-testid="milestone-card"
            data-card-key={group.key}
            data-milestone-id={group.milestoneId ?? ''}
            sx={{
              flex: '0 0 auto',
              width,
              minHeight: 0,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              bgcolor: vscodeColors.sideBarBackground,
              border: `1px solid ${vscodeColors.border}`,
              borderRadius: 1
            }}
          >
            <Box sx={{ px: 2, py: 1, borderBottom: `1px solid ${vscodeColors.border}`, flexShrink: 0 }}>
              {editing && editingMilestone ? (
                <MilestoneNameEditor key={editingMilestone.id} milestone={editingMilestone} onClose={() => setEditingMilestoneId(null)} />
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 28 }}>
                  <Typography
                    component="h2"
                    noWrap
                    title={group.label}
                    sx={{ fontSize: 13, fontWeight: 600, m: 0, minWidth: 0, color: group.milestoneId === null ? 'text.secondary' : 'text.primary' }}
                    data-testid="group-label"
                  >
                    {group.label}
                  </Typography>
                  <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0 }} data-testid="card-count">
                    {group.tasks.length} 件
                  </Typography>
                  {group.milestoneId !== null && (
                    <Tooltip title="名前を変更">
                      <IconButton
                        aria-label={`マイルストン「${group.label}」の名前を変更`}
                        data-rename-milestone={group.milestoneId}
                        onClick={() => void openMilestoneEditor(group.milestoneId as string)}
                        sx={{ ml: 'auto', color: 'text.secondary', flexShrink: 0 }}
                      >
                        <Pencil size={13} aria-hidden />
                      </IconButton>
                    </Tooltip>
                  )}
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
              selectedTaskId={selectedTaskId}
              pendingTaskIds={pendingTaskIds}
              sorting={sorting}
              resetScrollKey={resetScrollKey}
              onSort={onSort}
              onSelect={onSelect}
              onToggleCompleted={onToggleCompleted}
              onNavigateCard={(direction) => focusCard(index + direction)}
            />
            <Box sx={{ px: 1, py: 1, borderTop: `1px solid ${vscodeColors.border}`, flexShrink: 0 }}>
              {/* 登録先はこのカードに固定する（projectId と、マイルストンのカードなら milestoneId。未設定のカードは null） */}
              <InlineCreate
                buttonLabel="NEW TASK"
                inputLabel={`${cardName}に追加するタスクのタイトル`}
                placeholder="タスクのタイトル"
                maxLength={TASK_TITLE_MAX_LENGTH}
                disabledReason={disabledReason}
                keepOpenAfterCreate
                testId={`new-task-${group.milestoneId ?? 'unset'}`}
                onCreate={(title) => createTask.mutateAsync({ title, projectId: project.id, milestoneId: group.milestoneId })}
              />
            </Box>
            <CardResizeHandle width={width} onPreview={setPreviewWidth} onCommit={setMilestoneCardWidth} />
          </Box>
        )
      })}
      <Box sx={{ flex: '0 0 auto', width: 220, pt: 0.5 }}>
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
  )
}
