import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, RotateCcw, Save, Undo2 } from 'lucide-react'
import { isTaskCompleted, TASK_TITLE_MAX_LENGTH, type TaskDto } from '../../../../shared/contracts/tasks'
import { useDraftGuard } from '../drafts/DraftGuard'
import { formatTaskDateTime } from './TaskList'
import { TaskAssignmentField } from './TaskAssignmentField'
import { projectListQueryOptions } from '../projects/project-queries'
import { reopenBlockedReason } from './task-rules'
import { usePendingTaskIds, useSetTaskCompletedMutation, useUpdateTaskTitleMutation } from './task-queries'

// 詳細パネルのタスク編集。タイトルは明示的な保存方式（入力のたびには保存しない）。
// - 入力中の値はドラフトとして持ち、同じタスクの一覧再取得では上書きしない（key=タスクIDで作り直す）。
// - 保存成功後にだけ保存済みの値へ切り替える。失敗時は入力を残す。
// - 別タスクの選択・画面遷移・パネルを閉じる・完了操作の前は DraftGuard で確認する。
// - 所属の変更（TaskProjectField）は即時保存で、タイトルのドラフトとは独立している（フェーズ5.2）。
//   同じタスクの更新は順番に実行されるため、タイトル保存と所属変更の応答が互いの新しい値を古い値で上書きしない。
// TaskEditDialog（TaskRow のタスク名のクリック）でも同じ部品を使う（保存の経路・確認は詳細パネルと同じ）。autoFocusTitle で表示時にタイトルへフォーカスする
export function TaskEditor({ task, autoFocusTitle = false }: { task: TaskDto; autoFocusTitle?: boolean }) {
  const [draft, setDraft] = useState(task.title)
  const updateTitle = useUpdateTaskTitleMutation()
  const setCompleted = useSetTaskCompletedMutation()
  const pendingTaskIds = usePendingTaskIds()
  const { register, confirmLeave } = useDraftGuard()
  // 進行中の保存（DraftGuardが、保存の後処理まで終わるのを待てるようにする）
  const inFlightRef = useRef<Promise<boolean> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 最後に保存に成功したタイトル（応答のDTO）。Queryキャッシュからの再描画が届く前でも、保存済みの値と比べて未保存を判定する
  // （入力欄の更新と同じ描画で切り替えるため、保存直後に「未保存」と誤認しない。フェーズ5.3）。
  // キャッシュ側がそれ以降の更新（updatedAtが同じか新しい）を受け取ったら、キャッシュの値を使う。
  const [lastSaved, setLastSaved] = useState<Pick<TaskDto, 'title' | 'updatedAt'> | null>(null)
  const savedTitle = lastSaved && lastSaved.updatedAt > task.updatedAt ? lastSaved.title : task.title

  // 保存済みのタイトルが他の経路（一覧のインライン編集など。フェーズ5.9）で変わった時、こちらで編集していなければ新しい値に合わせる。
  // 編集中（未保存）の入力は変えない（新しい入力を古い値で巻き戻さない・上書きしない）
  const previousSavedRef = useRef(savedTitle)
  useEffect(() => {
    const previous = previousSavedRef.current
    previousSavedRef.current = savedTitle
    if (previous === savedTitle) return
    setDraft((current) => (current.trim() === previous ? savedTitle : current))
  }, [savedTitle])

  const busy = pendingTaskIds.has(task.id)
  const dirty = draft.trim() !== savedTitle
  const blank = draft.trim().length === 0
  const completed = isTaskCompleted(task)
  // 完了済みプロジェクトのタスクは未完了に戻せない（理由を先に示す。保証はMain側。フェーズ5.3）
  const projects = useQuery(projectListQueryOptions)
  const reopenBlocked = reopenBlockedReason(task, projects.data)

  const save = (): Promise<boolean> => {
    if (!dirty) return Promise.resolve(true)
    // 保存中に重ねて呼ばれたら、同じ保存の結果を返す（二重送信しない）
    if (inFlightRef.current) return inFlightRef.current
    const run = (async () => {
      try {
        const saved = await updateTitle.mutateAsync({ id: task.id, title: draft })
        // 保存後の値（前後の空白を除いたもの）を表示する
        setDraft(saved.title)
        setLastSaved({ title: saved.title, updatedAt: saved.updatedAt })
        // 再描画を待たずに「未保存なし」にする（直後の確認・終了で、保存済みの編集を未保存と誤認しない。フェーズ5.3）
        latest.current.dirty = false
        return true
      } catch {
        // 失敗・無効な入力の理由は下のエラー表示に出る。すぐ修正できるよう入力欄へフォーカスを戻す
        requestAnimationFrame(() => inputRef.current?.focus())
        return false
      } finally {
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = run
    return run
  }

  // DraftGuardから最新の状態を参照できるようにする
  // 破棄は再描画を待たずに「未保存なし」にする（破棄の直後の確認・画面移動で誤認しない。フェーズ5.6）
  const discardDraft = () => {
    latest.current.dirty = false
    setDraft(savedTitle)
  }
  const latest = useRef({ dirty, save, discard: discardDraft })
  latest.current = { dirty, save, discard: discardDraft }
  useEffect(
    () =>
      register({
        kind: 'task',
        targetId: task.id,
        isDirty: () => latest.current.dirty,
        save: () => latest.current.save(),
        discard: () => latest.current.discard(),
        waitForSave: async () => {
          await inFlightRef.current
        }
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
    if (busy || reopenBlocked) return
    if (!(await confirmLeave({ target: { kind: 'task', id: task.id } }))) return
    setCompleted.mutate({ id: task.id, completed: !completed })
  }

  const dates: [string, string | null][] = [
    ['作成日時', task.createdAt],
    ['更新日時', task.updatedAt],
    ['完了日時', task.completedAt]
  ]

  return (
    <Box sx={{ px: autoFocusTitle ? 0 : 4, pt: 2, pb: autoFocusTitle ? 0 : 4 }} data-testid="task-editor">
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
          autoFocus={autoFocusTitle}
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
              setDraft(savedTitle)
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
          disabled={busy || reopenBlocked !== null}
          onClick={() => void toggleCompleted()}
          startIcon={completed ? <RotateCcw size={14} aria-hidden /> : <CircleCheck size={14} aria-hidden />}
        >
          {setCompleted.isPending ? '更新中…' : completed ? '未完了に戻す' : '完了にする'}
        </Button>
      </Box>
      {reopenBlocked && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }} data-testid="task-reopen-blocked">
          {reopenBlocked}
        </Typography>
      )}
      {setCompleted.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
          完了状態を更新できませんでした: {setCompleted.error.message}
        </Alert>
      )}

      <TaskAssignmentField task={task} busy={busy} />

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
