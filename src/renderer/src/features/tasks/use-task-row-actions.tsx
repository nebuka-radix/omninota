import { useRef, useState } from 'react'
import { Alert, Box } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { useDraftGuard } from '../drafts/DraftGuard'
import { milestoneListQueryOptions } from '../milestones/milestone-queries'
import { projectListQueryOptions } from '../projects/project-queries'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { AssignMenu } from './AssignMenu'
import type { Assignment } from './assignment'
import { formatDueLong } from './due-format'
import { useInlineTitleEdit } from './inline-title-edit'
import { TaskRowMenu, useTaskDeletion } from './TaskDeletion'
import { useFocusReturn, useTaskDue } from './TaskDue'
import { useTaskEditDialog } from './TaskEditDialog'
import type { TaskRowActions, TaskRowMode } from '../../components/TaskRow'
import {
  useAssignInboxTasksMutation,
  usePendingTaskIds,
  useSetTaskAssignmentMutation,
  useSetTaskCompletedMutation,
  useTaskFavorite,
  useTaskImportant
} from './task-queries'
import { reopenBlockedReason } from './task-rules'

// TaskRow の行内操作（Inbox・プロジェクトのカード・Summary Review で共通）。保存の経路は画面によらず同じ。
// 画面ごとの違い（取得条件・選択集合・セクション・カード構成）は呼び出し側に残し、保存後の後処理だけをコールバックで受ける。
// - 完了: 既存の完了API（目的の状態）。完了済みプロジェクトのタスクは未完了に戻せない（理由を表示）。未保存の編集があれば先に確認する。
// - お気に入り: favorite-saver（同じタスクの保存キュー・最後に押した状態を保存・失敗時は保存済みの値へ戻して理由を表示）。
// - 期限: 既存の期限メニュー・日付指定（TaskDue）。対象はその行の1件。
// - 紐付け: 既存の紐付けメニュー（プロジェクト → マイルストン。最終選択で1回だけ保存）。対象はその行の1件。
//   Inbox のタスクは Inbox からの紐付けAPI、プロジェクト所属のタスクは単体の所属変更API（Inbox 専用APIを流用しない）。
// - 「…」: 削除だけ（確認なし。その行の1件）。一括削除は deleteTasks（Inbox の選択バー・Delete キー）。
// - タスク名: 編集モーダル（TaskEditor）とインライン編集（useInlineTitleEdit）。
export function useTaskRowActions(options: {
  // 全タスク（一覧の Query）。インライン編集の保存済みの値・対象の存在の判定に使う
  tasks: readonly TaskDto[]
  onAnnounce: (message: string) => void
  // 紐付け・所属変更に成功した後（Inbox: 選択から外す・詳細の選択を解除する など）
  onAssigned?: (saved: TaskDto) => void
  // 削除に成功した後（Inbox: 選択から外す など）
  onDeleted?: (tasks: readonly TaskDto[]) => void
}) {
  const { confirmLeave } = useDraftGuard()
  const { selectedTaskId, selectTask } = useWorkspace()
  const pendingTaskIds = usePendingTaskIds()
  const projectsQuery = useQuery(projectListQueryOptions)
  const milestonesQuery = useQuery(milestoneListQueryOptions)
  const setCompleted = useSetTaskCompletedMutation()
  const setAssignment = useSetTaskAssignmentMutation()
  const assignInbox = useAssignInboxTasksMutation()
  const favorite = useTaskFavorite()
  const important = useTaskImportant()
  const inlineEdit = useInlineTitleEdit(options.tasks)
  const editDialog = useTaskEditDialog()
  const optionsRef = useRef(options)
  optionsRef.current = options
  const announce = (message: string) => optionsRef.current.onAnnounce(message)

  const [blockedNotice, setBlockedNotice] = useState<string | null>(null)
  const [assignError, setAssignError] = useState<string | null>(null)
  const [assignTarget, setAssignTarget] = useState<{ task: TaskDto; anchor: HTMLElement; returnFocus: () => void } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ task: TaskDto; anchor: HTMLElement; mode: TaskRowMode; returnFocus: () => void } | null>(null)
  const assigningRef = useRef(false)
  const focusReturn = useFocusReturn()

  const due = useTaskDue({
    onSaved: (saved) => announce(saved.dueto ? `「${saved.title}」の${formatDueLong(saved.dueto)}` : `「${saved.title}」の期限を解除しました`)
  })

  const deletion = useTaskDeletion({
    onDeleted: (tasks) => {
      optionsRef.current.onDeleted?.(tasks)
      announce(tasks.length === 1 ? `「${tasks[0]!.title}」を削除しました` : `${tasks.length} 件のタスクを削除しました`)
    }
  })

  const toggleCompleted = async (task: TaskDto) => {
    if (pendingTaskIds.has(task.id)) return
    const blocked = reopenBlockedReason(task, projectsQuery.data)
    if (blocked) {
      setBlockedNotice(blocked)
      announce(blocked)
      return
    }
    setBlockedNotice(null)
    // 未保存の編集があるタスクは、完了操作の前に確認する（入力を黙って失わない）
    if (!(await confirmLeave({ target: { kind: 'task', id: task.id } }))) return
    setCompleted.mutate(
      { id: task.id, completed: task.doneOn === null },
      { onSuccess: (saved) => announce(`「${saved.title}」を${saved.doneOn === null ? '未完了に戻しました' : '完了にしました'}`) }
    )
  }

  const nameOf = (assignment: Assignment) => {
    const projectName = projectsQuery.data?.find((item) => item.id === assignment.projectId)?.name ?? ''
    const milestoneName = milestonesQuery.data?.find((item) => item.id === assignment.milestoneId)?.name ?? ''
    return `${projectName} › ${milestoneName}`
  }

  // 1件の紐付け・所属変更（最終的な所属先を選んだ時に1回だけ保存する）
  const assign = async (task: TaskDto, assignment: Assignment) => {
    if (assigningRef.current || assignment.projectId === null || assignment.milestoneId === null) return
    if (task.projectId === assignment.projectId && task.milestoneId === assignment.milestoneId) return
    assigningRef.current = true
    setAssignError(null)
    try {
      // 未保存のタイトル（詳細パネル・インライン編集）があれば、既存の確認を先に行う（黙って失わない）
      if (!(await confirmLeave({ target: { kind: 'task', id: task.id } }))) return
      const saved =
        task.projectId === null
          ? (await assignInbox.mutateAsync({ ids: [task.id], projectId: assignment.projectId, milestoneId: assignment.milestoneId }))[0]
          : await setAssignment.mutateAsync({ id: task.id, projectId: assignment.projectId, milestoneId: assignment.milestoneId })
      if (!saved) return
      optionsRef.current.onAssigned?.(saved)
      announce(`「${saved.title}」を「${nameOf(assignment)}」に${task.projectId === null ? '紐付けました' : '移動しました'}`)
    } catch (error) {
      setAssignError(`紐付けできませんでした: ${(error as Error).message}`)
    } finally {
      assigningRef.current = false
    }
  }

  // 所属の表示（「{プロジェクト名} / {マイルストン名}」）。一覧の Query（全件）から名前を引く（行ごとに IPC を発行しない）。
  // 所属がない（Inbox）・名前を取得できない時は null（「null / null」や空の「 / 」を出さない）
  const projectNames = new Map((projectsQuery.data ?? []).map((item) => [item.id, item.name]))
  const milestoneNames = new Map((milestonesQuery.data ?? []).map((item) => [item.id, item.name]))
  const assignmentLabel = (task: TaskDto): string | null => {
    if (task.projectId === null) return null
    const projectName = projectNames.get(task.projectId)
    const milestoneName = task.milestoneId === null ? undefined : milestoneNames.get(task.milestoneId)
    if (projectName === undefined) return null
    return milestoneName === undefined ? projectName : `${projectName} / ${milestoneName}`
  }

  const toggleImportant = async (task: TaskDto) => {
    if (pendingTaskIds.has(task.id)) return
    if (!await confirmLeave({ target: { kind: 'task', id: task.id } })) return
    const latest = optionsRef.current.tasks.find((item) => item.id === task.id)
    if (latest) important.toggle(latest)
  }

  // 行へ渡す操作
  const actions: TaskRowActions = {
    isFavorite: favorite.isFavorite,
    isImportant: important.isImportant,
    toggleImportant: (task) => { void toggleImportant(task) },
    toggleCompleted: (task) => void toggleCompleted(task),
    toggleFavorite: favorite.toggle,
    openDue: (task, anchor) => due.open(task, anchor),
    openAssign: (task, anchor) => {
      setAssignError(null)
      setAssignTarget({ task, anchor, returnFocus: focusReturn.capture(anchor) })
    },
    openMenu: (task, anchor, mode = 'Standard') => setRowMenu({ task, anchor, mode, returnFocus: focusReturn.capture(anchor) }),
    openEditor: (task, anchor) => editDialog.open(task.id, anchor),
    assignmentLabel,
    inlineEdit
  }

  const alerts = (
    <>
      {assignError && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setAssignError(null)} data-testid="assign-error">
          {assignError}
        </Alert>
      )}
      {important.error && <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={important.clearError} data-testid="task-important-error">
        {important.error}
      </Alert>}
      {favorite.error && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={favorite.clearError} data-testid="task-favorite-error">
          {favorite.error}
        </Alert>
      )}
      {due.error && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={due.clearError} data-testid="task-due-error">
          {due.error}
        </Alert>
      )}
      {deletion.error && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={deletion.clearError} data-testid="task-delete-error">
          {deletion.error}
        </Alert>
      )}
      {setCompleted.isError && (
        <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setCompleted.reset()}>
          完了状態を更新できませんでした: {setCompleted.error.message}
        </Alert>
      )}
      {blockedNotice && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }} onClose={() => setBlockedNotice(null)} data-testid="task-blocked-notice">
          {blockedNotice}
        </Alert>
      )}
    </>
  )

  const elements = (
    <Box component="span" sx={{ display: 'contents' }}>
      {rowMenu && (
        <TaskRowMenu
          task={rowMenu.task}
          anchor={rowMenu.anchor}
          onDue={rowMenu.mode === 'Compact' ? () => {
            const current = rowMenu
            setRowMenu(null)
            due.open(current.task, current.anchor)
          } : undefined}
          onAssign={rowMenu.mode === 'Compact' ? () => {
            const current = rowMenu
            setRowMenu(null)
            setAssignError(null)
            setAssignTarget({ task: current.task, anchor: current.anchor, returnFocus: current.returnFocus })
          } : undefined}
          pending={pendingTaskIds.has(rowMenu.task.id)}
          onDelete={() => deletion.request([rowMenu.task])}
          onClose={() => {
            rowMenu.returnFocus()
            setRowMenu(null)
          }}
        />
      )}
      {due.element}
      {assignTarget && (
        <AssignMenu
          tasks={[assignTarget.task]}
          anchor={assignTarget.anchor}
          onChoose={(assignment) => void assign(assignTarget.task, assignment)}
          onClose={() => {
            assignTarget.returnFocus()
            setAssignTarget(null)
          }}
        />
      )}
      {editDialog.element}
    </Box>
  )

  return {
    actions,
    inlineEdit,
    // 複数タスクの削除（Inbox の選択バー・Delete キー）。1件の削除と同じ処理
    deleteTasks: deletion.request,
    alerts,
    elements,
    // 選択中のタスクがこの操作で一覧から外れた時に使う
    clearSelectionIf: (taskId: string) => {
      if (selectedTaskId === taskId) selectTask(null)
    }
  }
}

