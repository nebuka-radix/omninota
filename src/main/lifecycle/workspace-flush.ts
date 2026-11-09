// 終了・ウィンドウを閉じる前に、Rendererへ確定済みWorkspace状態の保存完了を問い合わせる。
// electronをimportしないので、ホストNode.jsのテストから検証できる。
import { randomUUID } from 'node:crypto'
import type { WorkspaceFlushOutcome } from '../../shared/contracts/ipc'

// Rendererの応答に加え、Main側で判定する結果
// - timeout: 待機上限までに応答がない / unavailable: ウィンドウ・Rendererが存在しない
export type FlushCheckOutcome = WorkspaceFlushOutcome | 'timeout' | 'unavailable'

export const DEFAULT_FLUSH_TIMEOUT_MS = 3000

export function isFlushSuccessful(outcome: FlushCheckOutcome): boolean {
  // unavailable は保存を待つ相手がいないため、終了を妨げない（保存できたとはみなさない）
  return outcome === 'saved' || outcome === 'nothing' || outcome === 'disabled' || outcome === 'unavailable'
}

export type FlushRequester = {
  // 問い合わせを送り、結果を待つ。同時に複数回呼ばれた場合は同じ問い合わせを共有する。
  request(): Promise<FlushCheckOutcome>
  // Rendererからの応答。未知・期限切れのrequestIdは無視してfalseを返す。
  resolve(requestId: string, outcome: WorkspaceFlushOutcome): boolean
}

export function createFlushRequester(deps: {
  // 送信できなければfalse（ウィンドウ破棄済みなど）
  send: (requestId: string) => boolean
  timeoutMs?: number
  generateId?: () => string
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}): FlushRequester {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS
  const generateId = deps.generateId ?? (() => randomUUID())
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))

  const waiting = new Map<string, { finish: (outcome: FlushCheckOutcome) => void }>()
  let inflight: Promise<FlushCheckOutcome> | null = null

  const requestOnce = () =>
    new Promise<FlushCheckOutcome>((resolvePromise) => {
      const requestId = generateId()
      let timer: unknown = null
      const finish = (outcome: FlushCheckOutcome) => {
        if (!waiting.has(requestId)) return
        waiting.delete(requestId)
        if (timer !== null) clearTimer(timer)
        resolvePromise(outcome)
      }
      waiting.set(requestId, { finish })
      if (!deps.send(requestId)) {
        finish('unavailable')
        return
      }
      timer = setTimer(() => finish('timeout'), timeoutMs)
    })

  return {
    request() {
      inflight ??= requestOnce().finally(() => {
        inflight = null
      })
      return inflight
    },
    resolve(requestId, outcome) {
      const entry = waiting.get(requestId)
      if (!entry) return false
      entry.finish(outcome)
      return true
    }
  }
}

export type ExitKind = 'quit' | 'close'
export type FailureChoice = 'retry' | 'discard' | 'cancel'

export type ExitCoordinator = {
  // アプリ終了要求（before-quit）。続行してよければ何もしない。
  onQuitRequested(event: { preventDefault(): void }): void
  // ウィンドウを閉じる要求（BrowserWindowのclose）。続行してよければ何もしない。
  onWindowCloseRequested(event: { preventDefault(): void }): void
  // 新しいウィンドウを作った時などに、閉じる許可を取り消す。
  resetForNewWindow(): void
}

// 終了とウィンドウを閉じる処理を1か所で調整する。
// - 保存確認中に届いた要求は止めるだけで、問い合わせを重ねない（再入防止）。
// - 確認中に終了要求が来たら、確認後に終了まで進める。
// - 失敗・タイムアウト時は利用者に選んでもらう。ダイアログは確認1回につき1つだけ。
export function createExitCoordinator(deps: {
  requestFlush: () => Promise<FlushCheckOutcome>
  askOnFailure: (outcome: FlushCheckOutcome, kind: ExitKind) => Promise<FailureChoice>
  // 確認後に処理を再開する
  continueQuit: () => void
  continueClose: () => void
  logger?: Pick<Console, 'info' | 'warn'>
}): ExitCoordinator {
  const logger = deps.logger ?? console
  let state: 'idle' | 'checking' = 'idle'
  let pendingKind: ExitKind = 'close'
  let quitAllowed = false
  let closeAllowed = false

  const runCheck = async () => {
    for (;;) {
      const outcome = await deps.requestFlush()
      logger.info(`[exit] workspace保存の確認結果: ${outcome}`)
      if (isFlushSuccessful(outcome)) return true
      const choice = await deps.askOnFailure(outcome, pendingKind)
      logger.warn(`[exit] 保存を確認できませんでした（${outcome}）。選択: ${choice}`)
      if (choice === 'retry') continue
      return choice === 'discard'
    }
  }

  const start = (event: { preventDefault(): void }, kind: ExitKind) => {
    event.preventDefault()
    if (kind === 'quit') pendingKind = 'quit'
    if (state === 'checking') return
    state = 'checking'
    if (kind === 'close' && pendingKind !== 'quit') pendingKind = 'close'
    void runCheck().then((proceed) => {
      const kindToContinue = pendingKind
      state = 'idle'
      pendingKind = 'close'
      if (!proceed) return
      if (kindToContinue === 'quit') {
        quitAllowed = true
        closeAllowed = true
        deps.continueQuit()
      } else {
        closeAllowed = true
        deps.continueClose()
      }
    })
  }

  return {
    onQuitRequested(event) {
      if (quitAllowed) return
      start(event, 'quit')
    },
    onWindowCloseRequested(event) {
      if (closeAllowed) return
      start(event, 'close')
    },
    resetForNewWindow() {
      if (!quitAllowed) closeAllowed = false
    }
  }
}
