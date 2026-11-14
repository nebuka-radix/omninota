import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, ListSubheader, Menu, MenuItem, TextField, Typography } from '@mui/material'
import { CalendarDays, CalendarX2, Sun, Sunrise } from 'lucide-react'
import type { TaskDto, TaskDueChange } from '../../../../shared/contracts/tasks'
import { isValidDateOnly } from '../../../../shared/date-only'
import { formatDueLong } from './due-format'
import { useSetTaskDueMutation } from './task-queries'

// 期限の設定・変更・解除（フェーズ6）。TaskRow の期限表示・期限設定アイコン（と一覧の D キー）から使う。
// - 対象は常にメニューを開いた行の1タスク（複数選択中でも選択全体には適用しない。一括設定はない）。
// - 「Today」「Tomorrow」は Main が操作の時点のローカルの暦日で決める（メニューを開いたまま日付が変わっても古い日付を保存しない）。
// - 「日付指定」はダイアログの日付入力（キーボードでも入力できる）。確定するまで保存しない。過去の日付も可。
//   不正な日付は保存せず、入力と理由を残す（Main でも実在する暦日かを検証する）。
// - 保存は同じタスクの保存キュー（タイトルの保存・所属の変更・削除と順番）。保存に成功した応答だけで表示を変える。
//   失敗時は保存済みの値のまま、理由を表示する（onError）。
// - 閉じた後は、その行の一覧へフォーカスを戻す。

// メニューの表示位置の要素から、その行の一覧（listbox）を探す（行・行の「…」ボタンのどちらからでも）
// （TaskRow の操作ボタンは一覧の外側の重ね合わせ層にあるため、その行の一覧を data-list-id から探す）
export function listOf(anchor: HTMLElement): HTMLElement | null {
  const listId = anchor.closest<HTMLElement>('[data-list-id]')?.dataset['listId']
  const byId = listId ? document.getElementById(listId) : null
  return byId ?? anchor.closest<HTMLElement>('[role=listbox]') ?? anchor.closest('[data-testid=task-list-scroll]')?.querySelector<HTMLElement>('[role=listbox]') ?? null
}

// 閉じた後、その行の一覧へフォーカスを戻す（一覧が残っていれば）。
// - 戻り先は開いた時に決める（保存後に行の操作ボタンが作り直され、押したボタンが画面から外れていても戻せるようにする）。
// - フォーカスは、メニュー・ダイアログを外した描画の確定後に移す（ダイアログのフォーカスの閉じ込めに戻されないようにする）。
export function useFocusReturn() {
  const [target, setTarget] = useState<{ list: HTMLElement | null } | null>(null)
  useEffect(() => {
    if (!target) return
    const { list } = target
    if (list && document.contains(list)) list.focus({ preventScroll: true })
    setTarget(null)
  }, [target])
  return {
    // 開いた時に呼び、閉じた時に呼ぶ関数を返す
    capture: (anchor: HTMLElement) => {
      const list = listOf(anchor)
      return () => setTarget({ list })
    }
  }
}

export function useTaskDue(options: { onSaved: (task: TaskDto) => void }) {
  const setDue = useSetTaskDueMutation()
  const focusReturn = useFocusReturn()
  const [menu, setMenu] = useState<{ task: TaskDto; anchor: HTMLElement; returnFocus: () => void } | null>(null)
  const [dialog, setDialog] = useState<{ task: TaskDto; anchor: HTMLElement; returnFocus: () => void } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onSavedRef = useRef(options.onSaved)
  onSavedRef.current = options.onSaved


  const save = async (task: TaskDto, due: TaskDueChange): Promise<boolean> => {
    setError(null)
    try {
      const saved = await setDue.mutateAsync({ id: task.id, due })
      onSavedRef.current(saved)
      return true
    } catch (cause) {
      setError(`期限を保存できませんでした: ${(cause as Error).message}`)
      return false
    }
  }

  const choose = (due: TaskDueChange) => {
    if (!menu) return
    const { task, returnFocus } = menu
    setMenu(null)
    returnFocus()
    void save(task, due)
  }

  const element = (
    <>
      {menu && (
        <Menu
          open
          // 閉じた後のフォーカスは一覧へ戻す（returnFocus）
          disableRestoreFocus
          anchorEl={menu.anchor}
          onClose={() => {
            menu.returnFocus()
            setMenu(null)
          }}
          slotProps={{ list: { 'aria-label': `「${menu.task.title}」の期限`, dense: true }, paper: { sx: { minWidth: 200 } } }}
          data-testid="task-due-menu"
        >
          <ListSubheader sx={{ lineHeight: '26px', fontSize: 11 }}>
            {menu.task.dueto ? `現在: ${formatDueLong(menu.task.dueto).replace('期限 ', '')}` : '期限は未設定'}
          </ListSubheader>
          <MenuItem autoFocus onClick={() => choose({ kind: 'today' })} sx={{ fontSize: 13, gap: 1 }} data-testid="task-due-today">
            <Sun size={14} aria-hidden />
            Today
          </MenuItem>
          <MenuItem onClick={() => choose({ kind: 'tomorrow' })} sx={{ fontSize: 13, gap: 1 }} data-testid="task-due-tomorrow">
            <Sunrise size={14} aria-hidden />
            Tomorrow
          </MenuItem>
          <MenuItem
            onClick={() => {
              setDialog(menu)
              setMenu(null)
            }}
            sx={{ fontSize: 13, gap: 1 }}
            data-testid="task-due-pick"
          >
            <CalendarDays size={14} aria-hidden />
            日付指定…
          </MenuItem>
          <Divider />
          <MenuItem
            disabled={menu.task.dueto === null}
            onClick={() => choose({ kind: 'clear' })}
            sx={{ fontSize: 13, gap: 1 }}
            data-testid="task-due-clear"
          >
            <CalendarX2 size={14} aria-hidden />
            期限を解除
          </MenuItem>
        </Menu>
      )}
      {dialog && (
        <DueDateDialog
          task={dialog.task}
          pending={setDue.isPending}
          onConfirm={(date) => save(dialog.task, { kind: 'date', date })}
          onClose={() => {
            dialog.returnFocus()
            setDialog(null)
          }}
        />
      )}
    </>
  )

  return {
    open: (task: TaskDto, anchor: HTMLElement) => {
      setError(null)
      setMenu({ task, anchor, returnFocus: focusReturn.capture(anchor) })
    },
    element,
    error,
    clearError: () => setError(null)
  }
}

function DueDateDialog({
  task,
  pending,
  onConfirm,
  onClose
}: {
  task: TaskDto
  pending: boolean
  onConfirm: (date: string) => Promise<boolean>
  onClose: () => void
}) {
  // 既存の期限があれば初期値にする
  const [value, setValue] = useState(task.dueto ?? '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (saving || pending) return
    if (!isValidDateOnly(value)) {
      // 入力途中・存在しない日付は保存しない（入力は残す）
      setError('日付が正しくありません。実在する日付を入力してください。')
      return
    }
    setSaving(true)
    const ok = await onConfirm(value)
    setSaving(false)
    if (ok) onClose()
    else setError('保存できませんでした。理由は一覧の上に表示しています。')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // ダイアログ内のキーを一覧のショートカットへ伝えない
    event.stopPropagation()
  }

  return (
    <Dialog
      open
      disableRestoreFocus
      onClose={() => {
        if (!saving) onClose()
      }}
      onKeyDown={handleKeyDown}
      aria-labelledby="task-due-dialog-title"
      data-testid="task-due-dialog"
    >
      <Box component="form" onSubmit={(event) => void submit(event)} noValidate>
        <DialogTitle id="task-due-dialog-title" sx={{ fontSize: 15 }}>
          期限を指定
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 13, mb: 2, wordBreak: 'break-all' }}>「{task.title}」</Typography>
          <TextField
            type="date"
            value={value}
            onChange={(event) => {
              setValue(event.target.value)
              setError(null)
            }}
            autoFocus
            size="small"
            label="期限"
            error={error !== null}
            helperText={error ?? '過去の日付も指定できます'}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'data-testid': 'task-due-input', min: '0001-01-01', max: '9999-12-31' } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} disabled={saving} data-testid="task-due-cancel">
            キャンセル
          </Button>
          <Button type="submit" variant="contained" disabled={saving} data-testid="task-due-confirm">
            {saving ? '保存中…' : '確定'}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  )
}
