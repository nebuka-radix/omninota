import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { useBlocker } from '@tanstack/react-router'
import type { DraftKind } from '../../../../shared/contracts/ipc'
import { setDraftExitHandlers } from '../workspace/workspace-flush'

// 未保存の編集（ドラフト）を、黙って失わないための確認（フェーズ5.1でタスク名・プロジェクト名に一般化）。
// 方針: 編集中のドラフトは「タスクのタイトル」か「プロジェクト名」のどちらか1つ。
// - 別タスク・別プロジェクトの選択、他画面への遷移、詳細パネルを閉じる、完了操作、別の編集を始める前に confirmLeave() を呼ぶ。
// - 終了・ウィンドウを閉じる時は、既存の終了フロー（Main側のダイアログ）で確認する（ここで別のダイアログは出さない）。
export type DraftHandle = {
  kind: DraftKind
  targetId: string
  isDirty: () => boolean
  // 保存に成功したらtrue。失敗時は入力を残したままfalse。
  save: () => Promise<boolean>
  discard: () => void
}

type Choice = 'save' | 'discard' | 'cancel'

export const DRAFT_LABELS: Record<DraftKind, string> = { task: 'タスクのタイトル', project: 'プロジェクト名' }

type DraftGuardValue = {
  register: (handle: DraftHandle) => () => void
  // 続行してよければtrue（未保存の編集がない・保存した・破棄した）。キャンセル・保存失敗ならfalse。
  // target を指定すると、その対象の編集だけを確認する（完了操作など）。
  confirmLeave: (options?: { target?: { kind: DraftKind; id: string } }) => Promise<boolean>
}

const DraftGuardContext = createContext<DraftGuardValue | null>(null)

export function DraftGuardProvider({ children }: { children: ReactNode }) {
  // 登録中の編集欄（通常は画面に1つだけ。タスク詳細とプロジェクト見出しは同じ画面に同時には出ない）
  const handlesRef = useRef(new Set<DraftHandle>())
  const [prompt, setPrompt] = useState<{ kind: DraftKind; resolve: (choice: Choice) => void } | null>(null)
  const [saving, setSaving] = useState(false)
  // 確認ダイアログを重ねない
  const pendingRef = useRef<Promise<boolean> | null>(null)

  const dirtyHandles = () => [...handlesRef.current].filter((handle) => handle.isDirty())

  const register = useCallback((handle: DraftHandle) => {
    handlesRef.current.add(handle)
    return () => {
      handlesRef.current.delete(handle)
    }
  }, [])

  const confirmLeave = useCallback((options?: { target?: { kind: DraftKind; id: string } }) => {
    const target = options?.target
    const targets = dirtyHandles().filter(
      (handle) => !target || (handle.kind === target.kind && handle.targetId === target.id)
    )
    if (targets.length === 0) return Promise.resolve(true)
    if (pendingRef.current) return pendingRef.current

    const run = async () => {
      // 方針上は1つだけ。万一複数あっても、1つずつ順番に確認する（ダイアログは重ねない）
      for (const handle of targets) {
        const choice = await new Promise<Choice>((resolve) => setPrompt({ kind: handle.kind, resolve }))
        if (choice === 'cancel') return false
        if (choice === 'discard') {
          handle.discard()
          continue
        }
        setSaving(true)
        try {
          // 保存に失敗した場合は入力を残し、続行しない（エラーは編集欄に表示される）
          if (!(await handle.save())) return false
        } finally {
          setSaving(false)
        }
      }
      return true
    }
    pendingRef.current = run().finally(() => {
      pendingRef.current = null
      setPrompt(null)
    })
    return pendingRef.current
  }, [])

  // 画面遷移（ActivityBar・プロジェクトの選択など）の前に確認する。Electronでは beforeunload は使わない。
  // 確認が終わってから遷移するので、キャンセル時は表示中の画面・プロジェクト・選択を変えない。
  useBlocker({
    shouldBlockFn: async () => !(await confirmLeave()),
    enableBeforeUnload: false
  })

  // 終了フロー（Main側のダイアログ）から、未保存の有無・対象の確認と、保存・破棄を行えるようにする
  useEffect(
    () =>
      setDraftExitHandlers({
        isDirty: () => dirtyHandles().length > 0,
        kind: () => dirtyHandles()[0]?.kind ?? null,
        save: async () => {
          for (const handle of dirtyHandles()) {
            if (!(await handle.save())) return false
          }
          return true
        },
        discard: () => {
          for (const handle of dirtyHandles()) handle.discard()
        }
      }),
    []
  )

  const value = useMemo(() => ({ register, confirmLeave }), [register, confirmLeave])
  const choose = (choice: Choice) => prompt?.resolve(choice)
  const label = DRAFT_LABELS[prompt?.kind ?? 'task']

  return (
    <DraftGuardContext.Provider value={value}>
      {children}
      <Dialog
        open={prompt !== null}
        onClose={() => {
          if (!saving) choose('cancel')
        }}
        aria-labelledby="draft-guard-title"
        aria-describedby="draft-guard-description"
        // ポータル内のキー操作がReactの親（画面側）へ伝わらないようにする
        onKeyDown={(event) => event.stopPropagation()}
      >
        <DialogTitle id="draft-guard-title" sx={{ fontSize: 15 }}>
          未保存の変更があります
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="draft-guard-description" sx={{ fontSize: 13 }}>
            {label}の変更を保存しますか？
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => choose('cancel')} disabled={saving}>
            キャンセル
          </Button>
          <Button onClick={() => choose('discard')} disabled={saving} color="warning">
            破棄
          </Button>
          <Button onClick={() => choose('save')} disabled={saving} variant="contained" autoFocus>
            {saving ? '保存中…' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>
    </DraftGuardContext.Provider>
  )
}

export function useDraftGuard(): DraftGuardValue {
  const value = useContext(DraftGuardContext)
  if (!value) throw new Error('useDraftGuard は DraftGuardProvider の内側で使ってください')
  return value
}
