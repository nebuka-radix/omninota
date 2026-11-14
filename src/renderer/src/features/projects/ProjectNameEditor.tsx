import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Alert, Box, Button, IconButton, TextField, Tooltip, Typography } from '@mui/material'
import { useNavigate } from '@tanstack/react-router'
import { Pencil, Save, Undo2 } from 'lucide-react'
import { PROJECT_NAME_MAX_LENGTH, type ProjectDto } from '../../../../shared/contracts/projects'
import { projectIdFromRoute } from '../../../../shared/contracts/workspace'
import { useDraftGuard } from '../drafts/DraftGuard'
import { newProjectReturnRoute } from './new-project'
import { ProjectFavoriteButton } from './ProjectFavoriteButton'
import { useCreateProjectMutation, usePendingProjectIds, useRenameProjectMutation } from './project-queries'

const isImeEnter = (event: KeyboardEvent<HTMLElement>) =>
  event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)

// プロジェクト名の見出しと編集（明示的な保存方式）。既存プロジェクトの名前変更と、新規作成（フェーズ5.5）で共通に使う。
// 既存（project あり）:
// - 編集中の値はドラフト（key=プロジェクトIDで作り直す）。一覧の再取得では上書きしない。
// - 保存成功後にだけ保存済みの名前へ切り替える。失敗時は入力と理由を残す。
// 新規（project = null）:
// - 画面を開いた時から編集状態で、入力欄にフォーカスする。DBにはまだ作らない（仮の名前・空の名前のレコードも作らない）。
// - Enter（IME変換中を除く）か「作成」で作成する。blurだけでは作成しない。空白だけの名前では作成しない。
// - 作成に成功したら、作成したプロジェクトの画面へ移る（履歴を置き換える）。失敗時は入力と理由を残す。
// - Esc・「キャンセル」で、DBを書き換えずに直前の画面へ戻る。
// 共通: 未保存の確認は既存のDraftGuardに統合する（新規は、何か入力した場合だけ未保存として扱う）。
export function ProjectNameEditor({ project }: { project: ProjectDto | null }) {
  const creating = project === null
  const [editing, setEditing] = useState(creating)
  const [draft, setDraft] = useState(project?.name ?? '')
  const rename = useRenameProjectMutation()
  const create = useCreateProjectMutation()
  const mutation = creating ? create : rename
  const navigate = useNavigate()
  // 同じプロジェクトの更新（完了・取り消しを含む）が進行中なら、名前の保存・編集開始を受け付けない（フェーズ5.3）
  const pendingProjectIds = usePendingProjectIds()
  const busy = project !== null && pendingProjectIds.has(project.id)
  const { register, confirmLeave } = useDraftGuard()
  const inputRef = useRef<HTMLInputElement>(null)
  // 進行中の保存（DraftGuardが、保存の後処理まで終わるのを待てるようにする）
  const inFlightRef = useRef<Promise<boolean> | null>(null)
  // 新規: 作成済み・キャンセル済み（画面を離れるまでの間も、未保存として扱わない）
  const finishedRef = useRef(false)
  // 新規: 作成したプロジェクト（作成後の画面移動に使う）
  const createdRef = useRef<ProjectDto | null>(null)

  const dirty = creating ? !finishedRef.current && draft.trim().length > 0 : editing && draft.trim() !== project.name
  const blank = draft.trim().length === 0

  // 保存（新規なら作成）。成功したら true。新規の場合は作成したプロジェクトを createdRef に残す（画面の移動は呼び出し側が行う。
  // DraftGuard の「保存」から呼ばれた場合は、確認を出した遷移の側がそのまま移動する）
  const persist = (): Promise<boolean> => {
    if (!dirty) {
      if (!creating) setEditing(false)
      return Promise.resolve(!creating || finishedRef.current)
    }
    // 保存中に重ねて呼ばれたら、同じ保存の結果を返す（二重送信しない）
    if (inFlightRef.current) return inFlightRef.current
    const run = (async () => {
      try {
        if (project === null) {
          createdRef.current = await create.mutateAsync({ name: draft })
          finishedRef.current = true
        } else {
          const saved = await rename.mutateAsync({ id: project.id, name: draft })
          setDraft(saved.name)
          setEditing(false)
        }
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

  // 入力の破棄（DraftGuardの「破棄」・既存の「取り消す」）。新規の場合は画面を移動しない（移動は遷移の側が行う）
  const discard = () => {
    if (creating) {
      finishedRef.current = true
      latest.current.dirty = false
      create.reset()
      return
    }
    // 再描画を待たずに「未保存なし」にする（破棄の直後の画面移動で、破棄した入力を未保存と誤認しない。フェーズ5.6）
    latest.current.dirty = false
    setDraft(project.name)
    setEditing(false)
    rename.reset()
  }

  // DraftGuardから最新の状態を参照できるようにする
  const latest = useRef({ dirty, persist, discard })
  latest.current = { dirty, persist, discard }
  const targetId = project?.id ?? 'new'
  useEffect(
    () =>
      register({
        kind: 'project',
        targetId,
        isDirty: () => latest.current.dirty,
        save: () => latest.current.persist(),
        discard: () => latest.current.discard(),
        waitForSave: async () => {
          await inFlightRef.current
        }
      }),
    [register, targetId]
  )

  // 新規: 表示した時から入力欄にフォーカスする
  useEffect(() => {
    if (!creating) return
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [creating])

  const startEditing = async () => {
    // 別の編集（タスクのタイトルなど）が未保存なら、先に既存の確認を行う
    if (!(await confirmLeave())) return
    setDraft(project?.name ?? '')
    setEditing(true)
    // 入力欄へフォーカスを移し、名前全体を選択する（Enter・Escなどのキー操作が入力欄に届くように）
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }

  // 新規の作成を取りやめて、直前の画面へ戻る（DBは変更しない）
  const cancelCreate = () => {
    if (create.isPending || inFlightRef.current) return
    discard()
    const route = newProjectReturnRoute()
    const projectId = projectIdFromRoute(route)
    if (projectId) void navigate({ to: '/projects/$projectId', params: { projectId } })
    else if (route === '/inbox' || route === '/settings' || route === '/projects') void navigate({ to: route })
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (creating) {
      // 作成中の再送信（Enterの連打など）は受け付けない（二重送信しない）
      if (blank || finishedRef.current || inFlightRef.current) return
      if (!(await persist())) return
      const created = createdRef.current
      if (created) void navigate({ to: '/projects/$projectId', params: { projectId: created.id }, replace: true })
      return
    }
    if (!dirty || blank || rename.isPending || busy) {
      if (!dirty) discard()
      return
    }
    void persist()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 日本語IMEの変換確定のEnterでは保存しない
    if (isImeEnter(event)) {
      event.preventDefault()
      return
    }
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (creating) cancelCreate()
      else if (!rename.isPending) discard()
    }
  }

  if (!editing && project !== null) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <ProjectFavoriteButton project={project} />
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

  const helperText = creating
    ? 'Enter で作成、Esc でキャンセル'
    : blank
      ? 'プロジェクト名を入力してください。'
      : dirty
        ? '未保存の変更があります'
        : ' '

  return (
    <Box component="form" onSubmit={(event) => void handleSubmit(event)} noValidate sx={{ mb: 3 }} data-testid="project-name-editor">
      <TextField
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          if (mutation.isError) mutation.reset()
        }}
        onKeyDown={handleKeyDown}
        label={creating ? '新しいプロジェクトの名前' : 'プロジェクト名'}
        size="small"
        fullWidth
        autoComplete="off"
        inputRef={inputRef}
        error={!creating && blank}
        helperText={helperText}
        slotProps={{
          htmlInput: {
            maxLength: PROJECT_NAME_MAX_LENGTH,
            // 保存中は編集させない（保存するのは保存を始めた時点の値）
            readOnly: mutation.isPending
          }
        }}
      />
      <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
        <Button
          type="submit"
          size="small"
          variant="contained"
          disabled={!dirty || blank || busy || mutation.isPending}
          startIcon={<Save size={14} aria-hidden />}
        >
          {mutation.isPending ? '保存中…' : creating ? '作成' : '保存'}
        </Button>
        <Button
          size="small"
          disabled={mutation.isPending}
          onClick={creating ? cancelCreate : discard}
          startIcon={<Undo2 size={14} aria-hidden />}
        >
          {creating ? 'キャンセル' : '取り消す'}
        </Button>
      </Box>
      {mutation.isError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }} data-testid="project-name-error">
          {creating ? '作成できませんでした' : '保存できませんでした'}: {mutation.error.message}
        </Alert>
      )}
    </Box>
  )
}
