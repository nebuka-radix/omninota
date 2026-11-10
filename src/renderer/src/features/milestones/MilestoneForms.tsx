import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Box, Button, TextField } from '@mui/material'
import { Flag, Plus, Save, Undo2 } from 'lucide-react'
import { MILESTONE_NAME_MAX_LENGTH, type MilestoneDto } from '../../../../shared/contracts/milestones'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useCreateMilestoneMutation, useRenameMilestoneMutation } from './milestone-queries'

const isImeEnter = (event: KeyboardEvent<HTMLElement>) =>
  event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)

// マイルストンの登録欄（フェーズ5.4）。未送信の入力は、タスク・プロジェクトの追加欄と同じく未保存確認の対象外。
// 完了済みのプロジェクトでは無効にする（Main側でも拒否する）。
export function MilestoneCreateForm({ projectId, disabledReason }: { projectId: string; disabledReason?: string | undefined }) {
  const [name, setName] = useState('')
  const create = useCreateMilestoneMutation()
  const submittingRef = useRef(false)
  const blank = name.trim().length === 0
  const disabled = disabledReason !== undefined

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (blank || disabled || submittingRef.current) return
    submittingRef.current = true
    create.mutate(
      { projectId, name },
      {
        onSuccess: () => setName(''),
        onSettled: () => {
          submittingRef.current = false
        }
      }
    )
  }

  return (
    <Box component="form" onSubmit={submit} noValidate sx={{ mb: 3, flexShrink: 0 }} data-testid="milestone-create">
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <TextField
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            if (create.isError) create.reset()
          }}
          onKeyDown={(event) => {
            // 日本語IMEの変換確定のEnterでは登録しない
            if (isImeEnter(event)) event.preventDefault()
          }}
          placeholder={disabled ? disabledReason : '新しいマイルストン — 名前を入力して Enter'}
          size="small"
          fullWidth
          disabled={disabled}
          autoComplete="off"
          slotProps={{
            htmlInput: { 'aria-label': '新しいマイルストンの名前', maxLength: MILESTONE_NAME_MAX_LENGTH, readOnly: create.isPending }
          }}
        />
        <Button
          type="submit"
          size="small"
          variant="outlined"
          disabled={disabled || blank || create.isPending}
          startIcon={<Plus size={14} aria-hidden />}
          sx={{ flexShrink: 0, height: 32 }}
        >
          {create.isPending ? '保存中…' : 'マイルストン登録'}
        </Button>
      </Box>
      {create.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 1, py: 0 }}>
          登録できませんでした: {create.error.message}
        </Alert>
      )}
    </Box>
  )
}

// マイルストン名の編集欄（フェーズ5.4）。一覧の見出しの「名前変更」で開く。仮想リストの外に置くため、スクロールで入力を失わない。
// 未保存の確認は既存の DraftGuard に統合する（kind: 'milestone'。終了時のダイアログも共通）。
export function MilestoneNameEditor({ milestone, onClose }: { milestone: MilestoneDto; onClose: () => void }) {
  const [draft, setDraft] = useState(milestone.name)
  const rename = useRenameMilestoneMutation()
  const { register } = useDraftGuard()
  const inputRef = useRef<HTMLInputElement>(null)
  const inFlightRef = useRef<Promise<boolean> | null>(null)
  // 保存に成功して閉じた後は、未保存なしとして扱う（再描画を待たない）
  const closedRef = useRef(false)

  const dirty = !closedRef.current && draft.trim() !== milestone.name
  const blank = draft.trim().length === 0

  const save = (): Promise<boolean> => {
    if (!dirty) {
      onClose()
      return Promise.resolve(true)
    }
    if (inFlightRef.current) return inFlightRef.current
    const run = (async () => {
      try {
        await rename.mutateAsync({ id: milestone.id, name: draft })
        closedRef.current = true
        latest.current.dirty = false
        onClose()
        return true
      } catch {
        requestAnimationFrame(() => inputRef.current?.focus())
        return false
      } finally {
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = run
    return run
  }

  const cancel = () => {
    closedRef.current = true
    latest.current.dirty = false
    rename.reset()
    onClose()
  }

  const latest = useRef({ dirty, save, cancel })
  latest.current = { dirty, save, cancel }
  useEffect(
    () =>
      register({
        kind: 'milestone',
        targetId: milestone.id,
        isDirty: () => latest.current.dirty,
        save: () => latest.current.save(),
        discard: () => latest.current.cancel(),
        waitForSave: async () => {
          await inFlightRef.current
        }
      }),
    [register, milestone.id]
  )

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (blank || rename.isPending) return
    void save()
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mb: 3, flexShrink: 0 }} data-testid="milestone-name-editor">
      <TextField
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          if (rename.isError) rename.reset()
        }}
        onKeyDown={(event) => {
          if (isImeEnter(event)) event.preventDefault()
        }}
        label="マイルストン名"
        size="small"
        fullWidth
        autoComplete="off"
        inputRef={inputRef}
        error={blank}
        helperText={blank ? 'マイルストン名を入力してください。' : dirty ? '未保存の変更があります' : ' '}
        slotProps={{
          input: { startAdornment: <Flag size={14} aria-hidden style={{ marginRight: 8 }} /> },
          htmlInput: { maxLength: MILESTONE_NAME_MAX_LENGTH, readOnly: rename.isPending }
        }}
      />
      <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
        <Button type="submit" size="small" variant="contained" disabled={!dirty || blank || rename.isPending} startIcon={<Save size={14} aria-hidden />}>
          {rename.isPending ? '保存中…' : '保存'}
        </Button>
        <Button size="small" disabled={rename.isPending} onClick={cancel} startIcon={<Undo2 size={14} aria-hidden />}>
          取り消す
        </Button>
      </Box>
      {rename.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }}>
          保存できませんでした: {rename.error.message}
        </Alert>
      )}
    </Box>
  )
}
