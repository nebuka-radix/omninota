import { useRef, useState } from 'react'
import { Divider, Menu, MenuItem } from '@mui/material'
import { CalendarPlus, Link2, Trash2 } from 'lucide-react'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { useDeleteTaskMutation, useDeleteTasksMutation } from './task-queries'

// 行の「…」メニュー（TaskRow の3点ボタン・一覧の Shift+F10 / ContextMenu キー）。項目は「削除」だけ
// （名前の変更・期限・紐付けは TaskRow の各操作で行い、ここには重複して置かない）。
// 対象は常にその行の1タスク（Inboxの複数選択中でも。選択中のタスクの一括削除は選択バー・Delete キー）。確認ダイアログは出さない。
// MUI の Menu（↑↓・Enter・Esc。開いた時は項目にフォーカス）。閉じたらフォーカスは元の一覧へ戻す（呼び出し側）。
export function TaskRowMenu({
  task,
  anchor,
  onDelete,
  onDue,
  onAssign,
  pending = false,
  onClose
}: {
  task: TaskDto
  anchor: HTMLElement
  onDelete: () => void
  onDue?: () => void
  onAssign?: () => void
  pending?: boolean
  onClose: () => void
}) {
  return (
    <Menu
      open
      // 閉じた後のフォーカスは呼び出し側が一覧へ戻す
      disableRestoreFocus
      anchorEl={anchor}
      onClose={onClose}
      slotProps={{
        list: { 'aria-label': `「${task.title}」のメニュー`, dense: true },
        paper: { sx: { minWidth: 160 } }
      }}
      data-testid="task-row-menu"
    >
      {onDue && <MenuItem autoFocus disabled={pending} onClick={onDue} sx={{ fontSize: 13, gap: 1 }} data-testid="task-row-menu-due">
        <CalendarPlus size={14} aria-hidden />{task.dueto ? `期限を変更（${task.dueto}）` : '期限を設定'}
      </MenuItem>}
      {onAssign && <MenuItem disabled={pending} onClick={onAssign} sx={{ fontSize: 13, gap: 1 }} data-testid="task-row-menu-assign">
        <Link2 size={14} aria-hidden />紐付け
      </MenuItem>}
      {(onDue || onAssign) && <Divider />}
      <MenuItem
        autoFocus={!onDue}
        onClick={() => {
          onClose()
          onDelete()
        }}
        sx={{ fontSize: 13, gap: 1, color: 'error.light' }}
        data-testid="task-row-menu-delete"
      >
        <Trash2 size={14} aria-hidden />
        削除
      </MenuItem>
    </Menu>
  )
}

// タスクの削除（Inbox・プロジェクトのカードで共通）。フェーズ5.9から確認ダイアログを出さない。
// 1. 進行中の保存（保存キュー・編集欄）を待つ（同じタスクへの保存は、削除より先に終わる。削除の後に対象を作り直さない）。
// 2. 物理削除する（1件は tasks.delete、2件以上は tasks.deleteMany。どちらも Main のトランザクション）。二重実行しない。
// 3. 成功したら、対象の未保存の編集（タイトル）だけを確認なしで破棄し、選択中なら選択を解除する（呼び出し側が近くの行へ移す）。
//    他のタスクの未保存の入力・選択は変えない。
// 4. 失敗時は行・選択・入力を残し、理由を error に返す（一覧の上に表示する）。
export function useTaskDeletion(options: { onDeleted?: (tasks: readonly TaskDto[]) => void } = {}) {
  const { settle, discard } = useDraftGuard()
  const { selectedTaskId, selectTask } = useWorkspace()
  const deleteTask = useDeleteTaskMutation()
  const deleteTasks = useDeleteTasksMutation()
  const [error, setError] = useState<string | null>(null)
  // 削除中は次の要求を受け付けない（再描画を待たずに止める）
  const busyRef = useRef(false)
  const selectedRef = useRef(selectedTaskId)
  selectedRef.current = selectedTaskId
  const onDeletedRef = useRef(options.onDeleted)
  onDeletedRef.current = options.onDeleted

  const request = async (tasks: readonly TaskDto[]) => {
    if (busyRef.current || tasks.length === 0) return
    busyRef.current = true
    setError(null)
    try {
      await settle()
      const ids = tasks.map((task) => task.id)
      if (ids.length === 1) await deleteTask.mutateAsync({ id: ids[0]! })
      else await deleteTasks.mutateAsync({ ids })
      const removed = new Set(ids)
      discard((item) => item.kind === 'task' && removed.has(item.id))
      if (selectedRef.current !== null && removed.has(selectedRef.current)) selectTask(null)
      onDeletedRef.current?.(tasks)
    } catch (cause) {
      setError(`削除できませんでした: ${(cause as Error).message}`)
    } finally {
      busyRef.current = false
    }
  }

  return {
    request: (tasks: readonly TaskDto[]) => void request(tasks),
    error,
    clearError: () => setError(null),
    pending: deleteTask.isPending || deleteTasks.isPending
  }
}

