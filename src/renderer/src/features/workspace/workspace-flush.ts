import type { WorkspaceFlushOutcome } from '../../../../shared/contracts/ipc'
import { taskSaveQueue } from '../tasks/task-save-queue'
import { processFlushRequest, type DraftExitHandlers, type FlushResponse } from './flush-request-handler'

// 終了・ウィンドウを閉じる前の問い合わせに応答する。
// WorkspaceProviderがマウントされていない間（起動直後の読み込み中など）は、未保存の変更がないので nothing を返す。
type FlushHandler = () => Promise<WorkspaceFlushOutcome>

let currentHandler: FlushHandler | null = null

export function setWorkspaceFlushHandler(handler: FlushHandler): () => void {
  currentHandler = handler
  return () => {
    if (currentHandler === handler) currentHandler = null
  }
}

// 詳細パネルの未保存ドラフトの操作（DraftGuardProviderが登録する）
export type { DraftExitHandlers }

let currentDraftHandlers: DraftExitHandlers | null = null

export function setDraftExitHandlers(handlers: DraftExitHandlers): () => void {
  currentDraftHandlers = handlers
  return () => {
    if (currentDraftHandlers === handlers) currentDraftHandlers = null
  }
}

// 直前の操作で確定した値（キーボードでの幅変更は次の描画フレームで確定する）が保存キューに入るのを待つ。
// 画面が描画されない状態（最小化など）でも待ち続けないよう、上限を設ける。
const NEXT_FRAME_LIMIT_MS = 100
function waitForPendingCommits(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => setTimeout(resolve, 0)
    const timer = setTimeout(done, NEXT_FRAME_LIMIT_MS)
    requestAnimationFrame(() => {
      clearTimeout(timer)
      done()
    })
  })
}

// アプリ起動時に1回だけ呼ぶ。戻り値は購読解除関数。
export function installWorkspaceFlushListener(): () => void {
  return window.gtd.workspace.onFlushRequest((request) => {
    void (async () => {
      let response: FlushResponse
      try {
        response = await processFlushRequest(request.draftAction, {
          draft: currentDraftHandlers,
          flushWorkspace: currentHandler,
          waitForPendingCommits,
          waitForTaskSaves: () => taskSaveQueue.waitForIdle()
        })
      } catch (error) {
        console.error('[workspace] 終了前の保存確認に失敗しました', error)
        response = { outcome: 'failed' }
      }
      const result = await window.gtd.workspace.reportFlushResult({ requestId: request.requestId, ...response })
      if (!result.ok) console.error('[workspace] 保存確認の応答を送れませんでした', result.error)
    })()
  })
}
