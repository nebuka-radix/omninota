// 終了・ウィンドウを閉じる前に、Rendererへ確定済みWorkspace状態と未保存ドラフトの扱いを問い合わせる。
// electronをimportしないので、ホストNode.jsのテストから検証できる。
import { randomUUID } from 'node:crypto'
import type { DraftExitAction, DraftKind, WorkspaceFlushOutcome } from '../../shared/contracts/ipc'

// Rendererの応答に加え、Main側で判定する結果
// - timeout: 待機上限までに応答がない / unavailable: ウィンドウ・Rendererが存在しない
export type FlushCheckOutcome = WorkspaceFlushOutcome | 'timeout' | 'unavailable'

export const DEFAULT_FLUSH_TIMEOUT_MS = 3000
// 「保存して終了」はタイトルの保存（IPC・DB書き込み）を含むため、確認より長く待つ
export const DRAFT_SAVE_TIMEOUT_MS = 10000

export function isFlushSuccessful(outcome: FlushCheckOutcome): boolean {
  // unavailable は保存を待つ相手がいないため、終了を妨げない（保存できたとはみなさない）
  return outcome === 'saved' || outcome === 'nothing' || outcome === 'disabled' || outcome === 'unavailable'
}

export type FlushRequester = {
  // 問い合わせを送り、結果を待つ。同じ扱い（draftAction）の問い合わせが進行中なら共有する。
  request(draftAction?: DraftExitAction): Promise<FlushCheckOutcome>
  // Rendererからの応答。未知・期限切れのrequestIdは無視してfalseを返す。
  resolve(requestId: string, outcome: WorkspaceFlushOutcome, draftKind?: DraftKind): boolean
  // 直近の応答で伝えられた未保存ドラフトの対象（ダイアログの文言用。なければnull）
  lastDraftKind(): DraftKind | null
}

export function createFlushRequester(deps: {
  // 送信できなければfalse（ウィンドウ破棄済みなど）
  send: (request: { requestId: string; draftAction: DraftExitAction }) => boolean
  timeoutMs?: number
  draftSaveTimeoutMs?: number
  generateId?: () => string
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}): FlushRequester {
  const timeoutFor = (action: DraftExitAction) =>
    action === 'save' ? (deps.draftSaveTimeoutMs ?? DRAFT_SAVE_TIMEOUT_MS) : (deps.timeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS)
  const generateId = deps.generateId ?? (() => randomUUID())
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))

  const waiting = new Map<string, { finish: (outcome: FlushCheckOutcome) => void }>()
  const inflight = new Map<DraftExitAction, Promise<FlushCheckOutcome>>()
  let latestDraftKind: DraftKind | null = null

  const requestOnce = (draftAction: DraftExitAction) =>
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
      if (!deps.send({ requestId, draftAction })) {
        finish('unavailable')
        return
      }
      timer = setTimer(() => finish('timeout'), timeoutFor(draftAction))
    })

  return {
    request(draftAction = 'check') {
      let pending = inflight.get(draftAction)
      if (!pending) {
        pending = requestOnce(draftAction).finally(() => inflight.delete(draftAction))
        inflight.set(draftAction, pending)
      }
      return pending
    },
    resolve(requestId, outcome, draftKind) {
      const entry = waiting.get(requestId)
      if (!entry) return false
      latestDraftKind = draftKind ?? null
      entry.finish(outcome)
      return true
    },
    lastDraftKind() {
      return latestDraftKind
    }
  }
}

export type ExitKind = 'quit' | 'close'

// 未保存ドラフトがある時の終了ダイアログの文言。対象が伝えられなかった場合はタスクのタイトルとして扱う（フェーズ4.1の文言）。
export function unsavedDraftDialogText(draftKind: DraftKind | null, kind: ExitKind) {
  const verb = kind === 'quit' ? '終了' : '閉じる'
  const target = draftKind === 'project' ? 'プロジェクト名' : draftKind === 'milestone' ? 'マイルストン名' : 'タスクのタイトル'
  return {
    buttons: [`保存して${verb}`, `保存せずに${verb}`, 'キャンセル'],
    message: `${target}に未保存の変更があります`,
    detail:
      `「保存せずに」を選ぶと、${target}の変更だけを破棄します（ペイン幅などのUI設定は保存します）。\n` +
      '保存できなかった場合は中断し、入力は残ります。'
  }
}
// retry: 再試行 / save: ドラフトを保存して続行 / discard: 保存せずに続行 / cancel: 中断
export type FailureChoice = 'retry' | 'save' | 'discard' | 'cancel'

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
// - 確認・選択は順番に1つずつ行い、ダイアログを同時に重ねない。
// - 未保存ドラフト（unsaved-draft）: 保存して続行 / 保存せずに続行 / キャンセル。
//   「保存せずに」はドラフトの破棄だけを意味し、Workspace状態の保存確認は続けて行う。
//   保存に失敗（draft-save-failed）したら続行しない（ドラフトは画面に残り、理由は詳細パネルに表示される）。
export function createExitCoordinator(deps: {
  requestFlush: (draftAction: DraftExitAction) => Promise<FlushCheckOutcome>
  askOnFailure: (outcome: FlushCheckOutcome, kind: ExitKind) => Promise<FailureChoice>
  // 確認後に処理を再開する
  continueQuit: () => void
  continueClose: () => void
  // ウィンドウを閉じる要求（×）をアプリの終了要求として扱う（フェーズ5.9。ウィンドウは1つだけのため、
  // 最後のウィンドウを閉じたら macOS でも終了する）。確認後は continueQuit で終了まで進める。ダイアログの文言も「終了」になる
  closeQuitsApp?: boolean
  logger?: Pick<Console, 'info' | 'warn'>
}): ExitCoordinator {
  const logger = deps.logger ?? console
  let state: 'idle' | 'checking' = 'idle'
  let pendingKind: ExitKind = 'close'
  let quitAllowed = false
  let closeAllowed = false

  const runCheck = async (): Promise<boolean> => {
    let action: DraftExitAction = 'check'
    for (;;) {
      const outcome = await deps.requestFlush(action)
      logger.info(`[exit] 保存の確認結果（${action}）: ${outcome}`)
      if (isFlushSuccessful(outcome)) return true
      if (outcome === 'draft-save-failed') {
        logger.warn('[exit] 未保存の編集（タスクのタイトル・プロジェクト名）を保存できないため、中断します（ドラフトは保持）')
        return false
      }
      const choice = await deps.askOnFailure(outcome, pendingKind)
      logger.warn(`[exit] 選択: ${choice}（${outcome}）`)
      if (choice === 'cancel') return false
      if (outcome === 'unsaved-draft') {
        // 保存する・破棄する、のどちらでもWorkspace状態の確認まで行う
        action = choice === 'save' ? 'save' : 'discard'
        continue
      }
      // Workspace状態の保存失敗・応答なし
      if (choice === 'retry') {
        action = 'check'
        continue
      }
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
      start(event, deps.closeQuitsApp ? 'quit' : 'close')
    },
    resetForNewWindow() {
      if (!quitAllowed) closeAllowed = false
    }
  }
}
