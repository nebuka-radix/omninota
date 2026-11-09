import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material'
import { useBlocker } from '@tanstack/react-router'
import { setUnsavedDraftCheck } from '../workspace/workspace-flush'

// 詳細パネルの未保存の編集（ドラフト）を、黙って失わないための確認。
// - 別タスクの選択・他画面への遷移・詳細パネルを閉じる・完了操作の前に confirmLeave() を呼ぶ。
// - 終了・ウィンドウを閉じる時は、既存の終了フロー（Main側のダイアログ）で確認する。
export type DraftHandle = {
  taskId: string
  isDirty: () => boolean
  // 保存に成功したらtrue。失敗時は入力を残したままfalse。
  save: () => Promise<boolean>
  discard: () => void
}

type Choice = 'save' | 'discard' | 'cancel'

type DraftGuardValue = {
  register: (handle: DraftHandle) => () => void
  // 続行してよければtrue（未保存の編集がない・保存した・破棄した）。キャンセルならfalse。
  confirmLeave: (options?: { taskId?: string }) => Promise<boolean>
}

const DraftGuardContext = createContext<DraftGuardValue | null>(null)

export function DraftGuardProvider({ children }: { children: ReactNode }) {
  const handleRef = useRef<DraftHandle | null>(null)
  const [prompt, setPrompt] = useState<{ resolve: (choice: Choice) => void } | null>(null)
  const [saving, setSaving] = useState(false)
  // 確認ダイアログを重ねない
  const pendingRef = useRef<Promise<boolean> | null>(null)

  const register = useCallback((handle: DraftHandle) => {
    handleRef.current = handle
    return () => {
      if (handleRef.current === handle) handleRef.current = null
    }
  }, [])

  const confirmLeave = useCallback((options?: { taskId?: string }) => {
    const handle = handleRef.current
    if (!handle || !handle.isDirty()) return Promise.resolve(true)
    // 対象タスクの指定がある場合（完了操作など）は、そのタスクの編集だけを確認する
    if (options?.taskId !== undefined && options.taskId !== handle.taskId) return Promise.resolve(true)
    if (pendingRef.current) return pendingRef.current

    const run = async () => {
      const choice = await new Promise<Choice>((resolve) => setPrompt({ resolve }))
      if (choice === 'cancel') return false
      if (choice === 'discard') {
        handle.discard()
        return true
      }
      setSaving(true)
      try {
        // 保存に失敗した場合は入力を残し、続行しない（エラーは詳細パネルに表示される）
        return await handle.save()
      } finally {
        setSaving(false)
      }
    }
    pendingRef.current = run().finally(() => {
      pendingRef.current = null
      setPrompt(null)
    })
    return pendingRef.current
  }, [])

  // 画面遷移（ActivityBarなど）の前に確認する。Electronでは beforeunload は使わない。
  useBlocker({
    shouldBlockFn: async () => !(await confirmLeave()),
    enableBeforeUnload: false
  })

  // 終了フローへ未保存の有無を伝える
  useEffect(() => setUnsavedDraftCheck(() => handleRef.current?.isDirty() ?? false), [])

  const value = useMemo(() => ({ register, confirmLeave }), [register, confirmLeave])
  const choose = (choice: Choice) => prompt?.resolve(choice)

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
      >
        <DialogTitle id="draft-guard-title" sx={{ fontSize: 15 }}>
          未保存の変更があります
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="draft-guard-description" sx={{ fontSize: 13 }}>
            タスクのタイトルの変更を保存しますか？
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
