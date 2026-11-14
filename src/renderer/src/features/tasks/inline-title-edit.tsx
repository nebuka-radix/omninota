import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { TextField } from '@mui/material'
import { TASK_TITLE_MAX_LENGTH, type TaskDto } from '../../../../shared/contracts/tasks'
import { vscodeColors } from '../../theme'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useUpdateTaskTitleMutation } from './task-queries'

// タスク名のインライン編集（フェーズ5.9。Inboxの一覧・プロジェクトのカード）。
// - 編集中の状態（対象・入力・エラー）は一覧の外側（画面単位）に持つ。仮想化で行がアンマウントされても入力を失わない
//   （一覧は編集中の行を常に描画する。TaskList の rangeExtractor）。
// - 保存は既存のタイトル保存（useUpdateTaskTitleMutation → 同じタスクの保存キュー）を使う。詳細パネルの編集と同じ経路・同じ順序で保存する。
// - DraftGuard へ登録する（kind: task）。画面遷移・終了・ウィンドウを閉じる時は既存の確認（保存／破棄／キャンセル）を通る。
// - Enter・blur で保存、Esc で取り消し。IME変換中の Enter・Esc は無視する。Enter の後の blur で二重に保存しない。
// - 前後の空白を除いて空なら保存せず、入力とエラーを残す。保存済みと同じなら保存しない（updatedAt を変えない）。
// - 保存に失敗したら入力を残し、理由を表示する。
export type InlineEditState = {
  taskId: string
  scopeId?: string
  draft: string
  error: string | null
  saving: boolean
}

export type InlineTitleEditController = {
  state: InlineEditState | null
  // 編集を始める。別の行を編集中なら、先にその行を保存する（失敗したら始めない）
  start: (task: TaskDto, scopeId?: string) => Promise<boolean>
  change: (value: string) => void
  // 保存して閉じる。成功（または変更なし）なら true
  commit: () => Promise<boolean>
  cancel: () => void
}

const BLANK_MESSAGE = 'タイトルを入力してください。'

export function useInlineTitleEdit(tasks: readonly TaskDto[]): InlineTitleEditController {
  const [state, setState] = useState<InlineEditState | null>(null)
  const updateTitle = useUpdateTaskTitleMutation()
  const { register, confirmLeave } = useDraftGuard()
  const stateRef = useRef(state)
  stateRef.current = state
  const tasksRef = useRef(tasks)
  tasksRef.current = tasks
  const inFlightRef = useRef<Promise<boolean> | null>(null)

  const savedTitleOf = (taskId: string) => tasksRef.current.find((task) => task.id === taskId)?.title

  const commit = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return inFlightRef.current
    const current = stateRef.current
    if (!current) return true
    const title = current.draft.trim()
    const saved = savedTitleOf(current.taskId)
    if (title.length === 0) {
      setState({ ...current, error: BLANK_MESSAGE })
      return false
    }
    // 対象が一覧からなくなった（削除・非表示）場合は保存しない
    if (saved === undefined) {
      setState(null)
      return true
    }
    if (title === saved) {
      setState(null)
      return true
    }
    const run = (async () => {
      setState({ ...current, saving: true, error: null })
      stateRef.current = { ...current, saving: true, error: null }
      try {
        await updateTitle.mutateAsync({ id: current.taskId, title: current.draft })
        // 保存中に別の行の編集へ移っていなければ閉じる
        if (stateRef.current?.taskId === current.taskId) {
          stateRef.current = null
          setState(null)
        }
        return true
      } catch (error) {
        if (stateRef.current?.taskId === current.taskId) {
          const next = { ...stateRef.current, saving: false, error: `保存できませんでした: ${(error as Error).message}` }
          stateRef.current = next
          setState(next)
        }
        return false
      } finally {
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = run
    return run
  }, [updateTitle])

  const start = useCallback(
    async (task: TaskDto, scopeId?: string): Promise<boolean> => {
      const current = stateRef.current
      if (current?.taskId === task.id && current.scopeId === scopeId) return true
      if (current && !(await commit())) return false
      // 同じタスクを詳細パネルで編集中（未保存）なら、既存の確認を先に行う（同じタスクの2つの入力を同時に持たない）
      if (!(await confirmLeave({ target: { kind: 'task', id: task.id } }))) return false
      const next = { taskId: task.id, draft: task.title, error: null, saving: false, ...(scopeId ? { scopeId } : {}) }
      stateRef.current = next
      setState(next)
      return true
    },
    [commit, confirmLeave]
  )

  const change = useCallback((value: string) => {
    setState((current) => (current && !current.saving ? { ...current, draft: value, error: null } : current))
  }, [])

  const cancel = useCallback(() => {
    if (stateRef.current?.saving) return
    stateRef.current = null
    setState(null)
  }, [])

  // 編集中のタスクが一覧からなくなったら（削除・非表示）、入力を破棄して閉じる
  useEffect(() => {
    if (state && !state.saving && !tasks.some((task) => task.id === state.taskId)) {
      stateRef.current = null
      setState(null)
    }
  }, [state, tasks])

  // DraftGuard へ登録する（編集中の間だけ）。未保存の判定は保存済みのタイトル（Queryキャッシュ）と比べる
  const editingId = state?.taskId ?? null
  useEffect(() => {
    if (editingId === null) return
    return register({
      kind: 'task',
      targetId: editingId,
      isDirty: () => {
        const current = stateRef.current
        if (!current || current.taskId !== editingId) return false
        return current.draft.trim() !== savedTitleOf(editingId)
      },
      save: () => commit(),
      discard: () => {
        if (stateRef.current?.taskId !== editingId) return
        stateRef.current = null
        setState(null)
      },
      waitForSave: async () => {
        await inFlightRef.current
      }
    })
  }, [editingId, register, commit])

  return useMemo(() => ({ state, start, change, commit, cancel }), [state, start, change, commit, cancel])
}

// 行の上に重ねて表示する入力欄（listbox の外側に置く。option の中に textbox を入れない）
export function InlineTitleInput({
  controller,
  taskTitle,
  onDone
}: {
  controller: InlineTitleEditController
  taskTitle: string
  // Enter・Esc で閉じた時（一覧へフォーカスを戻す）。blur で閉じた時は呼ばない
  onDone: () => void
}) {
  const { state } = controller
  const inputRef = useRef<HTMLInputElement>(null)
  const editingId = state?.taskId
  useEffect(() => {
    if (!editingId) return
    // 表示時に入力欄へフォーカスし、既存の名前を選択する
    const input = inputRef.current
    input?.focus()
    input?.select()
  }, [editingId])
  if (!state) return null

  const handleKeyDown = async (event: KeyboardEvent<HTMLInputElement>) => {
    // 入力中のキーを一覧のショートカット（削除・選択など）へ伝えない
    event.stopPropagation()
    const composing = event.nativeEvent.isComposing || event.keyCode === 229
    if (event.key === 'Enter') {
      event.preventDefault()
      // 日本語IMEの変換確定のEnterでは保存しない
      if (composing) return
      if (await controller.commit()) onDone()
      return
    }
    if (event.key === 'Escape') {
      // 変換中の Esc は変換の取り消しだけ
      if (composing) return
      event.preventDefault()
      controller.cancel()
      onDone()
    }
  }

  return (
    <TextField
      value={state.draft}
      inputRef={inputRef}
      onChange={(event) => controller.change(event.target.value)}
      onKeyDown={(event) => void handleKeyDown(event as KeyboardEvent<HTMLInputElement>)}
      onBlur={() => void controller.commit()}
      // ドラッグ・行の選択へ伝えない
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      size="small"
      fullWidth
      autoComplete="off"
      error={state.error !== null}
      title={state.error ?? undefined}
      data-testid="inline-title-editor"
      slotProps={{
        htmlInput: {
          maxLength: TASK_TITLE_MAX_LENGTH,
          'aria-label': `「${taskTitle}」のタイトルを編集`,
          'aria-invalid': state.error !== null,
          'aria-describedby': state.error ? 'inline-title-error' : undefined,
          // 保存中は編集させない（フォーカスを失わないよう disabled にはしない）
          readOnly: state.saving
        }
      }}
      sx={{
        '& .MuiInputBase-root': { height: 26, fontSize: 13, bgcolor: vscodeColors.editorBackground },
        '& .MuiInputBase-input': { py: 0, px: 1 }
      }}
    />
  )
}
