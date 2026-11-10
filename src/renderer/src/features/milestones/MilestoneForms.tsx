import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Box, Button, TextField } from '@mui/material'
import { Flag, Save, Undo2 } from 'lucide-react'
import { MILESTONE_NAME_MAX_LENGTH, type MilestoneDto } from '../../../../shared/contracts/milestones'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useRenameMilestoneMutation } from './milestone-queries'

const isImeEnter = (event: KeyboardEvent<HTMLElement>) =>
  event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)

// マイルストン名の編集欄（フェーズ5.4）。フェーズ5.5からはカードの見出しの「名前を変更」で、その見出しの位置に開く
// （見出しは仮想リストの外にあるため、スクロールで入力を失わない）。Esc で取り消す。
// 登録は「NEW MILESTONE」（InlineCreate）で行う（5.4の常設の登録欄は廃止）。
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
    <Box component="form" onSubmit={handleSubmit} noValidate sx={{ flexShrink: 0 }} data-testid="milestone-name-editor">
      <TextField
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          if (rename.isError) rename.reset()
        }}
        onKeyDown={(event) => {
          if (isImeEnter(event)) {
            event.preventDefault()
            return
          }
          if (event.key === 'Escape' && !event.nativeEvent.isComposing && !rename.isPending) {
            event.preventDefault()
            cancel()
          }
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
        <Alert severity="error" variant="outlined" sx={{ mt: 1, py: 0 }}>
          保存できませんでした: {rename.error.message}
        </Alert>
      )}
    </Box>
  )
}
