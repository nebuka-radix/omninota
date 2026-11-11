import { useRef, useState } from 'react'
import { Divider, Menu, MenuItem } from '@mui/material'
import { Link2, PanelRight, Pencil, Trash2 } from 'lucide-react'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { useDeleteTaskMutation, useDeleteTasksMutation } from './task-queries'

// 行のメニュー（フェーズ5.6。5.9で「名前を変更」「詳細を表示」と、選択中の複数タスクへの一括操作を追加）。
// - count が2以上なら、紐付け・削除は選択中のタスクすべてが対象（項目名に件数を示す）。1なら行のタスクだけ
// MUI の Menu（↑↓・Enter・Esc。開いた時は先頭の項目にフォーカス）。閉じたらフォーカスは元の位置（一覧）へ戻る。
export function TaskRowMenu({
  task,
  anchor,
  count = 1,
  onShowDetail,
  onRename,
  onAssign,
  onDelete,
  onClose
}: {
  task: TaskDto
  anchor: HTMLElement
  count?: number
  onShowDetail?: (() => void) | undefined
  onRename?: (() => void) | undefined
  onAssign?: (() => void) | undefined
  onDelete: () => void
  onClose: () => void
}) {
  const bulk = count > 1
  const items = [
    onShowDetail && { key: 'detail', label: '詳細を表示', icon: PanelRight, run: onShowDetail },
    onRename && !bulk && { key: 'rename', label: '名前を変更（F2）', icon: Pencil, run: onRename },
    onAssign && { key: 'assign', label: bulk ? `選択した ${count} 件を紐付け…` : '紐付け…', icon: Link2, run: onAssign }
  ].filter((item): item is { key: string; label: string; icon: typeof Pencil; run: () => void } => Boolean(item))
  return (
    <Menu
      open
      anchorEl={anchor}
      onClose={onClose}
      slotProps={{
        list: { 'aria-label': bulk ? `選択した ${count} 件のタスクのメニュー` : `「${task.title}」のメニュー`, dense: true },
        paper: { sx: { minWidth: 200 } }
      }}
      data-testid="task-row-menu"
    >
      {items.map((item, index) => (
        <MenuItem
          key={item.key}
          autoFocus={index === 0}
          onClick={() => {
            onClose()
            item.run()
          }}
          sx={{ fontSize: 13, gap: 1 }}
          data-testid={`task-row-menu-${item.key}`}
        >
          <item.icon size={14} aria-hidden />
          {item.label}
        </MenuItem>
      ))}
      {items.length > 0 && <Divider />}
      <MenuItem
        autoFocus={items.length === 0}
        onClick={() => {
          onClose()
          onDelete()
        }}
        sx={{ fontSize: 13, gap: 1, color: 'error.light' }}
        data-testid="task-row-menu-delete"
      >
        <Trash2 size={14} aria-hidden />
        {bulk ? `選択した ${count} 件を削除` : 'タスクを削除'}
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
