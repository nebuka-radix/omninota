import { useRef, useState } from 'react'
import { Menu, MenuItem, Typography } from '@mui/material'
import { Link2, Trash2 } from 'lucide-react'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { useDeleteTaskMutation } from './task-queries'

// 行のメニュー（フェーズ5.6）。Inbox: 紐付け・削除、プロジェクトのカード: 削除。
// MUI の Menu（↑↓・Enter・Esc。開いた時は先頭の項目にフォーカス）。閉じたらフォーカスは元の位置（一覧）へ戻る。
export function TaskRowMenu({
  task,
  anchor,
  onAssign,
  onDelete,
  onClose
}: {
  task: TaskDto
  anchor: HTMLElement
  onAssign?: (() => void) | undefined
  onDelete: () => void
  onClose: () => void
}) {
  return (
    <Menu
      open
      anchorEl={anchor}
      onClose={onClose}
      slotProps={{ list: { 'aria-label': `「${task.title}」のメニュー`, dense: true }, paper: { sx: { minWidth: 180 } } }}
      data-testid="task-row-menu"
    >
      {onAssign && (
        <MenuItem
          autoFocus
          onClick={() => {
            onClose()
            onAssign()
          }}
          sx={{ fontSize: 13, gap: 1 }}
          data-testid="task-row-menu-assign"
        >
          <Link2 size={14} aria-hidden />
          紐付け…
        </MenuItem>
      )}
      <MenuItem
        autoFocus={!onAssign}
        onClick={() => {
          onClose()
          onDelete()
        }}
        sx={{ fontSize: 13, gap: 1, color: 'error.light' }}
        data-testid="task-row-menu-delete"
      >
        <Trash2 size={14} aria-hidden />
        タスクを削除…
      </MenuItem>
    </Menu>
  )
}

// タスクの削除の流れ（Inbox・プロジェクトのカードで共通。フェーズ5.6）。
// 1. 進行中の保存（保存キュー・編集欄）を待つ（同じタスクへの保存は、削除より先に終わる）。
// 2. 対象のタスクを示す確認ダイアログ。対象に未保存のタイトルがあれば、削除すると失われることも示す。
// 3. 確認後に物理削除（二重実行しない）。成功したら、対象の未保存の編集だけを破棄し、選択中なら選択を解除する
//    （詳細パネルはプロジェクトの詳細・空の表示に戻る）。他のタスクの未保存の入力・選択は変えない。
// 4. キャンセルでは何も変えない。失敗時はダイアログに理由を表示し、行・選択・入力を残す。
export function useTaskDeletion(options: { onDeleted?: (task: TaskDto) => void } = {}) {
  const { settle, hasDirty, discard } = useDraftGuard()
  const { selectedTaskId, selectTask } = useWorkspace()
  const deleteTask = useDeleteTaskMutation()
  const [target, setTarget] = useState<{ task: TaskDto; draftDirty: boolean } | null>(null)
  // 確認の準備中・削除中は、次の要求を受け付けない（再描画を待たずに止める）
  const busyRef = useRef(false)
  const selectedRef = useRef(selectedTaskId)
  selectedRef.current = selectedTaskId

  const request = async (task: TaskDto) => {
    if (busyRef.current || target) return
    busyRef.current = true
    try {
      await settle()
      deleteTask.reset()
      setTarget({ task, draftDirty: hasDirty((item) => item.kind === 'task' && item.id === task.id) })
    } finally {
      busyRef.current = false
    }
  }

  const confirm = () => {
    if (!target || busyRef.current) return
    busyRef.current = true
    const { task } = target
    deleteTask.mutate(
      { id: task.id },
      {
        onSuccess: () => {
          discard((item) => item.kind === 'task' && item.id === task.id)
          if (selectedRef.current === task.id) selectTask(null)
          setTarget(null)
          options.onDeleted?.(task)
        },
        onSettled: () => {
          busyRef.current = false
        }
      }
    )
  }

  const cancel = () => {
    if (deleteTask.isPending) return
    setTarget(null)
    deleteTask.reset()
  }

  const dialog = (
    <ConfirmDeleteDialog
      open={target !== null}
      title="タスクを削除しますか？"
      confirmLabel="削除"
      pending={deleteTask.isPending}
      error={deleteTask.isError ? `削除できませんでした: ${deleteTask.error.message}` : null}
      onConfirm={confirm}
      onCancel={cancel}
      testId="task-delete-dialog"
    >
      {target && (
        <>
          <Typography sx={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }} data-testid="task-delete-dialog-target">
            「{target.task.title}」
          </Typography>
          <Typography sx={{ fontSize: 13, mt: 1 }}>このタスクを完全に削除します。元に戻せません。</Typography>
          {target.draftDirty && (
            <Typography sx={{ fontSize: 13, mt: 1, color: 'warning.light' }} data-testid="task-delete-dialog-draft">
              このタスクの未保存のタイトルの変更も失われます。
            </Typography>
          )}
        </>
      )}
    </ConfirmDeleteDialog>
  )

  return { request: (task: TaskDto) => void request(task), dialog, pending: deleteTask.isPending }
}
