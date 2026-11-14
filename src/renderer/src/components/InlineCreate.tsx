import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Box, Button, TextField } from '@mui/material'
import { Plus, Save, X } from 'lucide-react'

const isImeEnter = (event: KeyboardEvent<HTMLElement>) =>
  event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

// 「NEW TASK」「NEW MILESTONE」の操作と、その場のインライン入力（フェーズ5.5）。
// - ボタンを押すとその場に入力欄を開く。Enter（IME変換中を除く）・「追加」で登録、Esc・「キャンセル」で閉じる。
// - 空白だけの名前では登録しない。確定前にDBへ何も作らない（作成は onCreate の1回だけ）。
// - 登録中は再送信しない（二重送信の防止）。失敗時は入力を残し、理由を表示する。
// - 登録先は呼び出し側が onCreate に固定して渡す（入力中に別の場所の所属を引き継がない）。
// - 未送信の入力は、従来の追加欄と同じく未保存確認（DraftGuard）の対象にしない。
// - disabledReason があれば操作できない（完了済みのプロジェクトなど）。理由は説明として読み上げる。
export function InlineCreate({
  buttonLabel,
  inputLabel,
  placeholder,
  submitLabel = '追加',
  maxLength,
  disabledReason,
  keepOpenAfterCreate = false,
  testId,
  onCreate
}: {
  buttonLabel: string
  inputLabel: string
  placeholder?: string
  submitLabel?: string
  maxLength: number
  disabledReason?: string | undefined
  keepOpenAfterCreate?: boolean
  testId: string
  onCreate: (value: string) => Promise<unknown>
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // 再描画を待たずに二重送信を止める
  const submittingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const reasonId = useId()
  const disabled = disabledReason !== undefined
  const blank = value.trim().length === 0

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  const close = () => {
    setOpen(false)
    setValue('')
    setError(null)
    requestAnimationFrame(() => buttonRef.current?.focus())
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (blank || disabled || submittingRef.current) return
    submittingRef.current = true
    setPending(true)
    try {
      await onCreate(value)
      setError(null)
      if (keepOpenAfterCreate) {
        setValue('')
        requestAnimationFrame(() => inputRef.current?.focus())
      } else {
        close()
      }
    } catch (caught) {
      // 失敗時は入力を残し、すぐ直せるよう入力欄へフォーカスを戻す
      setError(messageOf(caught))
      requestAnimationFrame(() => inputRef.current?.focus())
    } finally {
      submittingRef.current = false
      setPending(false)
    }
  }

  const reason = disabled ? (
    <Box component="span" id={reasonId} sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
      {disabledReason}
    </Box>
  ) : null

  if (!open) {
    return (
      <Box data-testid={testId}>
        <Button
          ref={buttonRef}
          size="small"
          fullWidth
          disabled={disabled}
          aria-describedby={disabled ? reasonId : undefined}
          startIcon={<Plus size={14} aria-hidden />}
          onClick={() => setOpen(true)}
          data-testid={`${testId}-button`}
          sx={{ justifyContent: 'flex-start', fontSize: 12, fontWeight: 600, letterSpacing: 0.4, color: 'text.secondary' }}
        >
          {buttonLabel}
        </Button>
        {reason}
      </Box>
    )
  }

  return (
    <Box component="form" onSubmit={(event) => void submit(event)} noValidate data-testid={testId}>
      <TextField
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(event) => {
          // 日本語IMEの変換確定のEnterでは登録しない
          if (isImeEnter(event)) {
            event.preventDefault()
            return
          }
          if (event.key === 'Escape' && !event.nativeEvent.isComposing && !pending) {
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }}
        placeholder={placeholder}
        size="small"
        fullWidth
        autoComplete="off"
        inputRef={inputRef}
        slotProps={{
          htmlInput: {
            'aria-label': inputLabel,
            'aria-describedby': disabled ? reasonId : undefined,
            maxLength,
            // 登録中は編集させない（フォーカスを失わないよう disabled にはしない）
            readOnly: pending
          }
        }}
      />
      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
        <Button
          type="submit"
          size="small"
          variant="contained"
          disabled={blank || disabled || pending}
          startIcon={<Save size={12} aria-hidden />}
          sx={{ fontSize: 12 }}
        >
          {pending ? '保存中…' : submitLabel}
        </Button>
        <Button size="small" disabled={pending} onClick={close} startIcon={<X size={12} aria-hidden />} sx={{ fontSize: 12 }}>
          キャンセル
        </Button>
      </Box>
      {reason}
      {error !== null && (
        <Alert severity="error" variant="outlined" sx={{ mt: 1, py: 0 }} data-testid={`${testId}-error`}>
          登録できませんでした: {error}
        </Alert>
      )}
    </Box>
  )
}
