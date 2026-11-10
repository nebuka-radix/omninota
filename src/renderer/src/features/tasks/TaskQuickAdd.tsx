import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Box, Button, TextField, Typography } from '@mui/material'
import { Plus } from 'lucide-react'
import { TASK_TITLE_MAX_LENGTH } from '../../../../shared/contracts/tasks'
import { useCreateTaskMutation } from './task-queries'

// タスクの追加欄。最終的な入力判定（所属先の存在・未完了を含む）はMain側で行う。
// - projectId: 追加先（nullは未所属 = Inbox）。作成時に明示的に渡す（フェーズ5.2）
// - targetLabel: 追加先の表示（「〈プロジェクト名〉に追加」など）
// - disabledReason: 追加できない理由（完了済みプロジェクトなど）。指定時は入力・登録を無効にして理由を表示する
// - 未送信の入力は未保存確認（DraftGuard）の対象にしない（既存方針）
const TARGET_ID = 'task-quick-add-target'

export function TaskQuickAdd({
  projectId,
  targetLabel,
  disabledReason
}: {
  projectId: string | null
  targetLabel: string
  disabledReason?: string | undefined
}) {
  const [title, setTitle] = useState('')
  const createTask = useCreateTaskMutation()
  // 再描画を待たずに二重送信を止めるためのフラグ
  const submittingRef = useRef(false)

  const submit = () => {
    if (submittingRef.current || disabledReason !== undefined) return
    submittingRef.current = true
    createTask.mutate(
      { title, projectId },
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
      <Typography id={TARGET_ID} variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }} data-testid="task-add-target">
        {disabled ? disabledReason : targetLabel}
      </Typography>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <TextField
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            if (createTask.isError) createTask.reset()
          }}
          onKeyDown={handleKeyDown}
          placeholder={`${targetLabel} — タイトルを入力して Enter`}
          size="small"
          fullWidth
          autoComplete="off"
          disabled={disabled}
          slotProps={{
            htmlInput: {
              'aria-label': 'タスクのタイトル',
              'aria-describedby': TARGET_ID,
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
