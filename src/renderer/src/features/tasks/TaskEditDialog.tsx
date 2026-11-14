import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogActions, DialogContent, DialogTitle, Button, IconButton } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useDraftGuard } from '../drafts/DraftGuard'
import { TaskEditor } from './TaskEditor'
import { useFocusReturn } from './TaskDue'
import { taskListQueryOptions } from './task-queries'

// タスク編集モーダル（TaskRow のタスク名のシングルクリック・一覧の E キー）。Inbox・プロジェクト・Summary Review で共通。
// - 中身は詳細パネルと同じ TaskEditor（タイトルの保存・完了・所属の変更。保存の経路を別に作らない）。
// - 表示するタスクは一覧の Query（全件）から探す。削除されたら閉じる。
// - 開いても右の詳細パネルの選択は変えない（同じタスクを二重に開かない）。開く前に、そのタスクの未保存の編集
//   （詳細パネル・インライン編集）を既存の確認で保存／破棄する（同じタスクの入力を2つ同時に持たない）。
// - 初期フォーカスはタイトル。Esc・閉じるボタン・背景のクリックで閉じる。未保存の入力があれば既存の確認（保存／破棄／キャンセル）を通し、
//   保存中ならその完了を待つ（DraftGuard.confirmLeave）。閉じた後は、その行の一覧へフォーカスを戻す。
export function useTaskEditDialog() {
  const { confirmLeave } = useDraftGuard()
  const [target, setTarget] = useState<{ taskId: string; returnFocus: () => void } | null>(null)
  const openingRef = useRef(false)
  const focusReturn = useFocusReturn()

  const open = async (taskId: string, anchor: HTMLElement) => {
    if (openingRef.current) return
    openingRef.current = true
    const returnFocus = focusReturn.capture(anchor)
    try {
      if (!(await confirmLeave({ target: { kind: 'task', id: taskId } }))) return
      setTarget({ taskId, returnFocus })
    } finally {
      openingRef.current = false
    }
  }

  const element = target ? (
    <TaskEditDialog
      key={target.taskId}
      taskId={target.taskId}
      onClosed={() => {
        target.returnFocus()
        setTarget(null)
      }}
    />
  ) : null

  return { open: (taskId: string, anchor: HTMLElement) => void open(taskId, anchor), openTaskId: target?.taskId ?? null, element }
}

function TaskEditDialog({ taskId, onClosed }: { taskId: string; onClosed: () => void }) {
  const { confirmLeave } = useDraftGuard()
  const task = useQuery({ ...taskListQueryOptions, select: (tasks) => tasks.find((item) => item.id === taskId) ?? null })
  const closingRef = useRef(false)
  const [closing, setClosing] = useState(false)
  const onClosedRef = useRef(onClosed)
  onClosedRef.current = onClosed

  // 削除された（一覧からなくなった）ら閉じる（未保存の入力は削除の処理が破棄済み）
  const missing = task.isSuccess && task.data === null
  useEffect(() => {
    if (missing) onClosedRef.current()
  }, [missing])

  const requestClose = async () => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    try {
      if (await confirmLeave({ target: { kind: 'task', id: taskId } })) onClosedRef.current()
    } finally {
      closingRef.current = false
      setClosing(false)
    }
  }

  return (
    <Dialog
      open
      // 閉じた後のフォーカスは一覧へ戻す（returnFocusToList）
      disableRestoreFocus
      onClose={() => void requestClose()}
      // 一覧のショートカット（削除など）へキー入力を伝えない
      onKeyDown={(event) => event.stopPropagation()}
      aria-labelledby="task-edit-dialog-title"
      data-testid="task-edit-dialog"
      data-task-id={taskId}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle id="task-edit-dialog-title" sx={{ fontSize: 15, pr: 6 }}>
        タスクを編集
        <IconButton
          aria-label="閉じる"
          onClick={() => void requestClose()}
          disabled={closing}
          size="small"
          sx={{ position: 'absolute', right: 8, top: 8 }}
          data-testid="task-edit-dialog-close-icon"
        >
          <X size={16} aria-hidden />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ pt: '4px !important' }}>
        {task.data ? <TaskEditor task={task.data} autoFocusTitle /> : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => void requestClose()} disabled={closing} data-testid="task-edit-dialog-close">
          閉じる
        </Button>
      </DialogActions>
    </Dialog>
  )
}
