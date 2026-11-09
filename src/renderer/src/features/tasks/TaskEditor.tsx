import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import { CircleCheck, RotateCcw, Save, Undo2 } from 'lucide-react'
import { isTaskCompleted, TASK_TITLE_MAX_LENGTH, type TaskDto } from '../../../../shared/contracts/tasks'
import { useDraftGuard } from '../drafts/DraftGuard'
import { formatTaskDateTime } from './TaskList'
import { usePendingTaskIds, useSetTaskCompletedMutation, useUpdateTaskTitleMutation } from './task-queries'

// 詳細パネルのタスク編集。タイトルは明示的な保存方式（入力のたびには保存しない）。
// - 入力中の値はドラフトとして持ち、同じタスクの一覧再取得では上書きしない（key=タスクIDで作り直す）。
// - 保存成功後にだけ保存済みの値へ切り替える。失敗時は入力を残す。
// - 別タスクの選択・画面遷移・パネルを閉じる・完了操作の前は DraftGuard で確認する。
export function TaskEditor({ task }: { task: TaskDto }) {
  const [draft, setDraft] = useState(task.title)
  const updateTitle = useUpdateTaskTitleMutation()
  const setCompleted = useSetTaskCompletedMutation()
  const pendingTaskIds = usePendingTaskIds()
  const { register, confirmLeave } = useDraftGuard()
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const busy = pendingTaskIds.has(task.id)
  const dirty = draft.trim() !== task.title
  const blank = draft.trim().length === 0
  const completed = isTaskCompleted(task)

  const save = async (): Promise<boolean> => {
    if (!dirty) return true
    if (submittingRef.current) return false
    submittingRef.current = true
    try {
      const saved = await updateTitle.mutateAsync({ id: task.id, title: draft })
      // 保存後の値（前後の空白を除いたもの）を表示する
      setDraft(saved.title)
      return true
    } catch {
      // 失敗・無効な入力の理由は下のエラー表示に出る。すぐ修正できるよう入力欄へフォーカスを戻す
      requestAnimationFrame(() => inputRef.current?.focus())
      return false
    } finally {
      submittingRef.current = false
    }
  }

  // DraftGuardから最新の状態を参照できるようにする
  const latest = useRef({ dirty, save, discard: () => setDraft(task.title) })
  latest.current = { dirty, save, discard: () => setDraft(task.title) }
  useEffect(
    () =>
      register({
        kind: 'task',
        targetId: task.id,
        isDirty: () => latest.current.dirty,
        save: () => latest.current.save(),
        discard: () => latest.current.discard()
      }),
    [register, task.id]
  )

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || blank || busy) return
    void save()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 日本語IMEの変換確定のEnterでは保存しない
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault()
    }
  }

  const toggleCompleted = async () => {
    if (busy) return
    if (!(await confirmLeave({ target: { kind: 'task', id: task.id } }))) return
    setCompleted.mutate({ id: task.id, completed: !completed })
  }

  const dates: [string, string | null][] = [
    ['作成日時', task.createdAt],
    ['更新日時', task.updatedAt],
    ['完了日時', task.completedAt]
  ]

  return (
    <Box sx={{ px: 4, pt: 2, pb: 4 }} data-testid="task-editor">
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <TextField
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            if (updateTitle.isError) updateTitle.reset()
          }}
          onKeyDown={handleKeyDown}
          label="タイトル"
          size="small"
          fullWidth
          autoComplete="off"
          error={blank}
          helperText={blank ? 'タイトルを入力してください。' : dirty ? '未保存の変更があります' : ' '}
          inputRef={inputRef}
          slotProps={{
            htmlInput: {
              maxLength: TASK_TITLE_MAX_LENGTH,
              // 保存中は編集させない（フォーカスを失わないようdisabledにはしない）
              readOnly: updateTitle.isPending
            }
          }}
        />
        <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
          <Button
            type="submit"
            size="small"
            variant="contained"
            disabled={!dirty || blank || busy}
            startIcon={<Save size={14} aria-hidden />}
          >
            {updateTitle.isPending ? '保存中…' : '保存'}
          </Button>
          <Button
            size="small"
            disabled={!dirty || updateTitle.isPending}
            onClick={() => {
              setDraft(task.title)
              updateTitle.reset()
            }}
            startIcon={<Undo2 size={14} aria-hidden />}
          >
            変更を取り消す
          </Button>
        </Box>
      </Box>

      {updateTitle.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
          保存できませんでした: {updateTitle.error.message}
        </Alert>
      )}

      <Box sx={{ mt: 4, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="task-status">
          {completed ? '完了' : '未完了'}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={() => void toggleCompleted()}
          startIcon={completed ? <RotateCcw size={14} aria-hidden /> : <CircleCheck size={14} aria-hidden />}
        >
          {setCompleted.isPending ? '更新中…' : completed ? '未完了に戻す' : '完了にする'}
        </Button>
      </Box>
      {setCompleted.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
          完了状態を更新できませんでした: {setCompleted.error.message}
        </Alert>
      )}

      <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 3, rowGap: 1.5, mt: 4, mb: 0 }}>
        {dates
          .filter((entry): entry is [string, string] => entry[1] !== null)
          .map(([label, value]) => (
            <Box key={label} sx={{ display: 'contents' }}>
              <Typography component="dt" variant="body2" color="text.secondary">
                {label}
              </Typography>
              <Typography component="dd" variant="body2" sx={{ m: 0, userSelect: 'text' }} data-testid={`task-${label}`}>
                {formatTaskDateTime(value)}
              </Typography>
            </Box>
          ))}
      </Box>
    </Box>
  )
}
