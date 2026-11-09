import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Box, Button, TextField } from '@mui/material'
import { Plus } from 'lucide-react'
import { TASK_TITLE_MAX_LENGTH } from '../../../../shared/contracts/tasks'
import { useCreateTaskMutation } from './task-queries'

// 縦断検証用の最小入力欄。最終的な入力判定はMain側で行う。
export function TaskQuickAdd() {
  const [title, setTitle] = useState('')
  const createTask = useCreateTaskMutation()
  // 再描画を待たずに二重送信を止めるためのフラグ
  const submittingRef = useRef(false)

  const submit = () => {
    if (submittingRef.current) return
    submittingRef.current = true
    createTask.mutate(
      { title },
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

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mb: 4 }}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
        <TextField
          value={title}
          onChange={(event) => {
            setTitle(event.target.value)
            if (createTask.isError) createTask.reset()
          }}
          onKeyDown={handleKeyDown}
          placeholder="タスクのタイトルを入力して Enter"
          size="small"
          fullWidth
          autoComplete="off"
          slotProps={{
            htmlInput: {
              'aria-label': 'タスクのタイトル',
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
          disabled={isBlank || createTask.isPending}
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
