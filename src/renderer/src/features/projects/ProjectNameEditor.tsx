import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Box, Button, IconButton, TextField, Tooltip, Typography } from '@mui/material'
import { Pencil, Save, Undo2 } from 'lucide-react'
import { PROJECT_NAME_MAX_LENGTH, type ProjectDto } from '../../../../shared/contracts/projects'
import { useDraftGuard } from '../drafts/DraftGuard'
import { usePendingProjectIds, useRenameProjectMutation } from './project-queries'

// プロジェクト名の見出しと編集（明示的な保存方式）。
// - 編集中の値はドラフト（key=プロジェクトIDで作り直す）。一覧の再取得では上書きしない。
// - 保存成功後にだけ保存済みの名前へ切り替える。失敗時は入力と理由を残す。
// - 未保存の確認は既存のDraftGuardに統合する（タスクのタイトルと同時には1つだけ）。
export function ProjectNameEditor({ project }: { project: ProjectDto }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(project.name)
  const rename = useRenameProjectMutation()
  // 同じプロジェクトの更新（完了・取り消しを含む）が進行中なら、名前の保存・編集開始を受け付けない（フェーズ5.3）
  const busy = usePendingProjectIds().has(project.id)
  const { register, confirmLeave } = useDraftGuard()
  const inputRef = useRef<HTMLInputElement>(null)
  // 進行中の保存（DraftGuardが、保存の後処理まで終わるのを待てるようにする）
  const inFlightRef = useRef<Promise<boolean> | null>(null)

  const dirty = editing && draft.trim() !== project.name
  const blank = draft.trim().length === 0

  const save = (): Promise<boolean> => {
    if (!dirty) {
      setEditing(false)
      return Promise.resolve(true)
    }
    // 保存中に重ねて呼ばれたら、同じ保存の結果を返す（二重送信しない）
    if (inFlightRef.current) return inFlightRef.current
    const run = (async () => {
      try {
        const saved = await rename.mutateAsync({ id: project.id, name: draft })
        setDraft(saved.name)
        setEditing(false)
        // 再描画を待たずに「未保存なし」にする（直後の確認で、保存済みの編集を未保存と誤認しない。フェーズ5.3）
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

  const cancel = () => {
    setDraft(project.name)
    setEditing(false)
    rename.reset()
  }

  // DraftGuardから最新の状態を参照できるようにする
  const latest = useRef({ dirty, save, cancel })
  latest.current = { dirty, save, cancel }
  useEffect(
    () =>
      register({
        kind: 'project',
        targetId: project.id,
        isDirty: () => latest.current.dirty,
        save: () => latest.current.save(),
        discard: () => latest.current.cancel(),
        waitForSave: async () => {
          await inFlightRef.current
        }
      }),
    [register, project.id]
  )

  const startEditing = async () => {
    // 別の編集（タスクのタイトルなど）が未保存なら、先に既存の確認を行う
    if (!(await confirmLeave())) return
    setDraft(project.name)
    setEditing(true)
    // 入力欄へフォーカスを移し、名前全体を選択する（Enter・Escなどのキー操作が入力欄に届くように）
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!dirty || blank || rename.isPending || busy) {
      if (!dirty) cancel()
      return
    }
    void save()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 日本語IMEの変換確定のEnterでは保存しない
    if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault()
  }

  if (!editing) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <Typography component="h1" sx={{ fontSize: 15, fontWeight: 600, m: 0, wordBreak: 'break-all' }} data-testid="project-name">
          {project.name}
        </Typography>
        <Tooltip title="名前を変更">
          {/* 無効なボタンでもツールチップを出せるよう span で包む */}
          <span>
            <IconButton aria-label="プロジェクト名を変更" disabled={busy} onClick={() => void startEditing()} sx={{ color: 'text.secondary' }}>
              <Pencil size={14} aria-hidden />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    )
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate sx={{ mb: 3 }} data-testid="project-name-editor">
      <TextField
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          if (rename.isError) rename.reset()
        }}
        onKeyDown={handleKeyDown}
        label="プロジェクト名"
        size="small"
        fullWidth
        autoComplete="off"
        inputRef={inputRef}
        error={blank}
        helperText={blank ? 'プロジェクト名を入力してください。' : dirty ? '未保存の変更があります' : ' '}
        slotProps={{
          htmlInput: {
            maxLength: PROJECT_NAME_MAX_LENGTH,
            // 保存中は編集させない（保存するのは保存を始めた時点の値）
            readOnly: rename.isPending
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
