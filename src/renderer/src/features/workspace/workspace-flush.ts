import type { WorkspaceFlushOutcome } from '../../../../shared/contracts/ipc'

// 終了・ウィンドウを閉じる前の保存問い合わせに応答する。
// WorkspaceProviderがマウントされていない間（起動直後の読み込み中など）は、未保存の変更がないので nothing を返す。
type FlushHandler = () => Promise<WorkspaceFlushOutcome>

let currentHandler: FlushHandler | null = null

export function setWorkspaceFlushHandler(handler: FlushHandler): () => void {
  currentHandler = handler
  return () => {
    if (currentHandler === handler) currentHandler = null
  }
}

// 詳細パネルに未保存の編集があるかどうか（DraftGuardProviderが登録する）。
let currentDraftCheck: (() => boolean) | null = null

export function setUnsavedDraftCheck(check: () => boolean): () => void {
  currentDraftCheck = check
  return () => {
    if (currentDraftCheck === check) currentDraftCheck = null
  }
}

// アプリ起動時に1回だけ呼ぶ。戻り値は購読解除関数。
export function installWorkspaceFlushListener(): () => void {
  return window.gtd.workspace.onFlushRequest((requestId) => {
    void (async () => {
      let outcome: WorkspaceFlushOutcome
      try {
        outcome = currentHandler ? await currentHandler() : 'nothing'
        // Workspace状態の保存に問題がなければ、未保存の編集の有無を伝える。
        // 確認はMain側の終了フローのダイアログで行う（画面側で別のダイアログを重ねない）。
        if (outcome !== 'failed' && currentDraftCheck?.()) outcome = 'unsaved-draft'
      } catch (error) {
        console.error('[workspace] 終了前の保存確認に失敗しました', error)
        outcome = 'failed'
      }
      const result = await window.gtd.workspace.reportFlushResult({ requestId, outcome })
      if (!result.ok) console.error('[workspace] 保存確認の応答を送れませんでした', result.error)
    })()
  })
}
