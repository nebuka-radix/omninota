import { useRef, useState, type FormEvent, type KeyboardEvent, type Ref } from 'react'
import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import { Plus } from 'lucide-react'
import { TASK_TITLE_MAX_LENGTH } from '../../../../shared/contracts/tasks'
import { useCreateTaskMutation } from './task-queries'

// タスクの追加欄。最終的な入力判定（所属先の存在・未完了を含む）はMain側で行う。
// - projectId: 追加先（nullは未所属 = Inbox）。作成時に明示的に渡す（フェーズ5.2）
// - disabledReason: 追加できない理由（完了済みプロジェクトなど）。指定時は入力・登録を無効にして理由を表示する
// - 未送信の入力は未保存確認（DraftGuard）の対象にしない（既存方針）
// - フェーズ5.8: 追加先の説明行（「追加先: Inbox（…）」）は表示しない。入力欄のアクセシブル名「タスクのタイトル」は維持する
const REASON_ID = 'task-quick-add-disabled-reason'

// - milestoneId: 追加先のマイルストン（フェーズ5.4）。フェーズ5.5からInboxだけで使う（projectId = null のため常に null）
export function TaskQuickAdd({
  projectId,
  milestoneId = null,
  disabledReason,
  inputRef
}: {
  projectId: string | null
  milestoneId?: string | null
  disabledReason?: string | undefined
  inputRef?: Ref<HTMLInputElement>
}) {
  const [title, setTitle] = useState('')
  const createTask = useCreateTaskMutation()
  // 再描画を待たずに二重送信を止めるためのフラグ
  const submittingRef = useRef(false)

  const submit = () => {
    if (submittingRef.current || disabledReason !== undefined) return
    submittingRef.current = true
    createTask.mutate(
      { title, projectId, milestoneId: projectId === null ? null : milestoneId },
      {
        // 成功した場合だけ入力を消す。失敗時は入力を残す。
        onSuccess: () => setTitle(''),
        onSettled: () => {
          submittingRef.current = false
        }
      }
    )
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 日本語IMEの変換確定のEnterでは登録しない。
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) {
      event.preventDefault()
    }
  }

  const isBlank = title.trim().length === 0
  const disabled = disabledReason !== undefined

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mb: 4 }}>
      {disabled && (
        <Typography id={REASON_ID} variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }} data-testid="task-add-disabled-reason">
          {disabledReason}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <TextField
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            if (createTask.isError) createTask.reset()
          }}
          onKeyDown={handleKeyDown}
          placeholder="タイトルを入力して Enter"
          size="small"
          fullWidth
          autoComplete="off"
          disabled={disabled}
          inputRef={inputRef}
          slotProps={{
            htmlInput: {
              'aria-label': 'タスクのタイトル',
              'aria-describedby': disabled ? REASON_ID : undefined,
              maxLength: TASK_TITLE_MAX_LENGTH,
              // 保存中は編集させない（フォーカスを失わないようdisabledにはしない）
              readOnly: createTask.isPending
            }
          }}
        />
        <Button
          type="submit"
          variant="contained"
          size="small"
          disabled={disabled || isBlank || createTask.isPending}
          startIcon={<Plus size={14} aria-hidden />}
          sx={{ flexShrink: 0, height: 32 }}
        >
          {createTask.isPending ? '保存中…' : '登録'}
        </Button>
      </Box>
      {createTask.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
          保存できませんでした: {createTask.error.message}
        </Alert>
      )}
    </Box>
  )
}
