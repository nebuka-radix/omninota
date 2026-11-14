import { describe, expect, it, vi } from 'vitest'
import { watchParentProcess } from '../../src/main/lifecycle/parent-watch'
import {
  createExitCoordinator,
  createFlushRequester,
  type ExitKind,
  type FailureChoice,
  type FlushCheckOutcome,
  unsavedDraftDialogText
} from '../../src/main/lifecycle/workspace-flush'
import type { DraftExitAction } from '../../src/shared/contracts/ipc'
import { workspaceFlushResultArgsSchema } from '../../src/shared/validation/workspace'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const silent = { info: () => {}, warn: () => {} }

describe('Rendererへの保存確認（FlushRequester）', () => {
  it('Rendererの応答で完了する', async () => {
    const sent: string[] = []
    const requester = createFlushRequester({ send: (request) => (sent.push(request.requestId), true), generateId: () => 'req-1' })
    const result = requester.request()
    expect(sent).toEqual(['req-1'])
    expect(requester.resolve('req-1', 'saved')).toBe(true)
    expect(await result).toBe('saved')
  })

  it('同時の問い合わせは1件にまとめる', async () => {
    const send = vi.fn(() => true)
    const requester = createFlushRequester({ send, generateId: () => 'req-1' })
    const first = requester.request()
    const second = requester.request()
    expect(send).toHaveBeenCalledTimes(1)
    requester.resolve('req-1', 'nothing')
    expect(await first).toBe('nothing')
    expect(await second).toBe('nothing')
  })

  it('応答がなければ待機上限でtimeout（成功とは扱わない）', async () => {
    vi.useFakeTimers()
    try {
      const requester = createFlushRequester({ send: () => true, timeoutMs: 3000, generateId: () => 'req-1' })
      const result = requester.request()
      vi.advanceTimersByTime(2999)
      await Promise.resolve()
      vi.advanceTimersByTime(1)
      expect(await result).toBe('timeout')
      // 期限切れ後の応答は無視する
      expect(requester.resolve('req-1', 'saved')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ウィンドウが破棄済みで送れなければunavailable', async () => {
    const requester = createFlushRequester({ send: () => false })
    expect(await requester.request()).toBe('unavailable')
  })

  it('問い合わせにはドラフトの扱いを含め、保存（save）は確認より長く待つ', async () => {
    vi.useFakeTimers()
    try {
      const sent: string[] = []
      let n = 0
      const requester = createFlushRequester({
        send: (request) => (sent.push(request.draftAction), true),
        timeoutMs: 3000,
        draftSaveTimeoutMs: 10000,
        generateId: () => `req-${++n}`
      })
      const check = requester.request()
      const save = requester.request('save')
      expect(sent).toEqual(['check', 'save'])
      vi.advanceTimersByTime(3000)
      expect(await check).toBe('timeout')
      expect(requester.resolve('req-2', 'saved')).toBe(true) // 保存はまだ待っている
      expect(await save).toBe('saved')
    } finally {
      vi.useRealTimers()
    }
  })

  it('応答で伝えられた未保存ドラフトの対象（タスク名・プロジェクト名）を保持する', async () => {
    let n = 0
    const requester = createFlushRequester({ send: () => true, generateId: () => `req-${++n}` })
    expect(requester.lastDraftKind()).toBeNull()
    const first = requester.request()
    requester.resolve('req-1', 'unsaved-draft', 'project')
    await first
    expect(requester.lastDraftKind()).toBe('project')
    const second = requester.request()
    requester.resolve('req-2', 'saved')
    await second
    expect(requester.lastDraftKind()).toBeNull()
  })

  it('未知のrequestIdは無視する', () => {
    const requester = createFlushRequester({ send: () => true, generateId: () => 'req-1' })
    void requester.request()
    expect(requester.resolve('other', 'saved')).toBe(false)
  })
})

describe('終了・ウィンドウを閉じる処理の調整（ExitCoordinator）', () => {
  function setup(outcomes: FlushCheckOutcome[], choices: FailureChoice[] = [], closeQuitsApp = false) {
    const requestFlush = vi.fn(async (_action: DraftExitAction): Promise<FlushCheckOutcome> => outcomes.shift() ?? 'saved')
    const askOnFailure = vi.fn(
      async (_outcome: FlushCheckOutcome, _kind: ExitKind): Promise<FailureChoice> => choices.shift() ?? 'cancel'
    )
    const continueQuit = vi.fn()
    const continueClose = vi.fn()
    const coordinator = createExitCoordinator({ requestFlush, askOnFailure, continueQuit, continueClose, closeQuitsApp, logger: silent })
    const event = () => ({ preventDefault: vi.fn() })
    return { coordinator, requestFlush, askOnFailure, continueQuit, continueClose, event }
  }

  it('終了要求を止めて保存を確認し、成功したら終了を再開する（再開後の要求は止めない）', async () => {
    const t = setup(['saved'])
    const first = t.event()
    t.coordinator.onQuitRequested(first)
    expect(first.preventDefault).toHaveBeenCalled()
    await tick()
    expect(t.continueQuit).toHaveBeenCalledTimes(1)

    const again = t.event()
    t.coordinator.onQuitRequested(again)
    expect(again.preventDefault).not.toHaveBeenCalled()
    // 終了に伴うウィンドウのcloseも止めない
    const close = t.event()
    t.coordinator.onWindowCloseRequested(close)
    expect(close.preventDefault).not.toHaveBeenCalled()
  })

  it('確認中に繰り返し終了要求が来ても、確認と再開は1回だけ', async () => {
    let finish: (outcome: FlushCheckOutcome) => void = () => {}
    const requestFlush = vi.fn(() => new Promise<FlushCheckOutcome>((resolve) => (finish = resolve)))
    const continueQuit = vi.fn()
    const coordinator = createExitCoordinator({
      requestFlush,
      askOnFailure: vi.fn(),
      continueQuit,
      continueClose: vi.fn(),
      logger: silent
    })
    const events = [1, 2, 3].map(() => ({ preventDefault: vi.fn() }))
    events.forEach((event) => coordinator.onQuitRequested(event))
    expect(events.every((event) => event.preventDefault.mock.calls.length === 1)).toBe(true)
    expect(requestFlush).toHaveBeenCalledTimes(1)
    finish('saved')
    await tick()
    expect(continueQuit).toHaveBeenCalledTimes(1)
  })

  it('ウィンドウを閉じる要求は、確認後にウィンドウだけを閉じる（アプリは終了しない）', async () => {
    const t = setup(['nothing'])
    t.coordinator.onWindowCloseRequested(t.event())
    await tick()
    expect(t.continueClose).toHaveBeenCalledTimes(1)
    expect(t.continueQuit).not.toHaveBeenCalled()
    // 新しいウィンドウでは、閉じる前に再び確認する
    t.coordinator.resetForNewWindow()
    const close = t.event()
    t.coordinator.onWindowCloseRequested(close)
    expect(close.preventDefault).toHaveBeenCalled()
  })

  describe('×（最後のウィンドウを閉じる）でアプリを終了する（フェーズ5.9。closeQuitsApp）', () => {
    it('閉じる要求を止めて保存を確認し、成功したら終了まで進める（ウィンドウだけ閉じる経路は使わない）', async () => {
      const t = setup(['saved'], [], true)
      const close = t.event()
      t.coordinator.onWindowCloseRequested(close)
      expect(close.preventDefault).toHaveBeenCalledTimes(1)
      await tick()
      expect(t.continueQuit).toHaveBeenCalledTimes(1)
      expect(t.continueClose).not.toHaveBeenCalled()
      // 終了の再開後に届く before-quit・ウィンドウの close は止めない（再入しない・無限ループにしない）
      const quit = t.event()
      t.coordinator.onQuitRequested(quit)
      const closeAgain = t.event()
      t.coordinator.onWindowCloseRequested(closeAgain)
      expect(quit.preventDefault).not.toHaveBeenCalled()
      expect(closeAgain.preventDefault).not.toHaveBeenCalled()
      expect(t.requestFlush).toHaveBeenCalledTimes(1)
    })

    it('未保存の編集: ダイアログは「終了」の文言の種類（quit）で確認し、キャンセルならウィンドウもアプリも残す', async () => {
      const t = setup(['unsaved-draft'], ['cancel'], true)
      t.coordinator.onWindowCloseRequested(t.event())
      await tick()
      expect(t.askOnFailure).toHaveBeenCalledWith('unsaved-draft', 'quit')
      expect(t.continueQuit).not.toHaveBeenCalled()
      expect(t.continueClose).not.toHaveBeenCalled()
      // キャンセル後の×は再び確認する
      const again = t.event()
      t.coordinator.onWindowCloseRequested(again)
      expect(again.preventDefault).toHaveBeenCalled()
    })

    it('保存して終了: 保存に成功した後だけ終了する', async () => {
      const t = setup(['unsaved-draft', 'saved'], ['save'], true)
      t.coordinator.onWindowCloseRequested(t.event())
      await tick()
      expect(t.requestFlush.mock.calls.map(([action]) => action)).toEqual(['check', 'save'])
      expect(t.continueQuit).toHaveBeenCalledTimes(1)
    })

    it('確認中に×・⌘Q（SIGINT）が重なっても、確認と終了は1回だけ', async () => {
      let finish: (outcome: FlushCheckOutcome) => void = () => {}
      const requestFlush = vi.fn(() => new Promise<FlushCheckOutcome>((resolve) => (finish = resolve)))
      const continueQuit = vi.fn()
      const coordinator = createExitCoordinator({
        requestFlush,
        askOnFailure: vi.fn(),
        continueQuit,
        continueClose: vi.fn(),
        closeQuitsApp: true,
        logger: silent
      })
      coordinator.onWindowCloseRequested({ preventDefault: vi.fn() })
      coordinator.onWindowCloseRequested({ preventDefault: vi.fn() })
      coordinator.onQuitRequested({ preventDefault: vi.fn() })
      coordinator.onQuitRequested({ preventDefault: vi.fn() })
      finish('saved')
      await tick()
      expect(requestFlush).toHaveBeenCalledTimes(1)
      expect(continueQuit).toHaveBeenCalledTimes(1)
    })
  })

  it('閉じる確認中に終了要求が来たら、確認後に終了まで進める', async () => {
    let finish: (outcome: FlushCheckOutcome) => void = () => {}
    const requestFlush = vi.fn(() => new Promise<FlushCheckOutcome>((resolve) => (finish = resolve)))
    const continueQuit = vi.fn()
    const continueClose = vi.fn()
    const coordinator = createExitCoordinator({
      requestFlush,
      askOnFailure: vi.fn(),
      continueQuit,
      continueClose,
      logger: silent
    })
    coordinator.onWindowCloseRequested({ preventDefault: vi.fn() })
    coordinator.onQuitRequested({ preventDefault: vi.fn() })
    finish('saved')
    await tick()
    expect(requestFlush).toHaveBeenCalledTimes(1)
    expect(continueQuit).toHaveBeenCalledTimes(1)
    expect(continueClose).not.toHaveBeenCalled()
  })

  it('失敗時: 再試行で成功すれば終了する（ダイアログは失敗1回につき1つ）', async () => {
    const t = setup(['failed', 'saved'], ['retry'])
    t.coordinator.onQuitRequested(t.event())
    await tick()
    await tick()
    expect(t.askOnFailure).toHaveBeenCalledTimes(1)
    expect(t.requestFlush).toHaveBeenCalledTimes(2)
    expect(t.continueQuit).toHaveBeenCalledTimes(1)
  })

  it('タイムアウト時: 「保存せずに終了」を選べば終了する', async () => {
    const t = setup(['timeout'], ['discard'])
    t.coordinator.onQuitRequested(t.event())
    await tick()
    expect(t.askOnFailure).toHaveBeenCalledWith('timeout', 'quit')
    expect(t.continueQuit).toHaveBeenCalledTimes(1)
  })

  it('失敗時: キャンセルすれば終了を中断し、次の終了要求で再び確認する', async () => {
    const t = setup(['failed', 'saved'], ['cancel'])
    t.coordinator.onQuitRequested(t.event())
    await tick()
    expect(t.continueQuit).not.toHaveBeenCalled()

    const again = t.event()
    t.coordinator.onQuitRequested(again)
    expect(again.preventDefault).toHaveBeenCalled()
    await tick()
    expect(t.continueQuit).toHaveBeenCalledTimes(1)
  })

  it('未保存ドラフト: キャンセルなら中断し、編集を続けられる（ドラフトは変えない）', async () => {
    const t = setup(['unsaved-draft'], ['cancel'])
    t.coordinator.onQuitRequested(t.event())
    await tick()
    expect(t.askOnFailure).toHaveBeenCalledWith('unsaved-draft', 'quit')
    expect(t.requestFlush.mock.calls.map((call) => call[0])).toEqual(['check'])
    expect(t.continueQuit).not.toHaveBeenCalled()
  })

  it('未保存ドラフト: 保存して終了 → 保存に成功した後だけ終了する', async () => {
    const t = setup(['unsaved-draft', 'saved'], ['save'])
    t.coordinator.onQuitRequested(t.event())
    await tick()
    await tick()
    expect(t.requestFlush.mock.calls.map((call) => call[0])).toEqual(['check', 'save'])
    expect(t.continueQuit).toHaveBeenCalledTimes(1)
  })

  it('未保存ドラフト: 保存に失敗したら終了せず、ダイアログを重ねない', async () => {
    const t = setup(['unsaved-draft', 'draft-save-failed'], ['save'])
    t.coordinator.onQuitRequested(t.event())
    await tick()
    await tick()
    expect(t.askOnFailure).toHaveBeenCalledTimes(1)
    expect(t.continueQuit).not.toHaveBeenCalled()
    // 次の終了要求では最初から確認し直す
    const again = t.event()
    t.coordinator.onQuitRequested(again)
    expect(again.preventDefault).toHaveBeenCalled()
  })

  it('未保存ドラフト: 保存せずに閉じる → ドラフトだけ破棄し、Workspace状態の確認は行う', async () => {
    const t = setup(['unsaved-draft', 'saved'], ['discard'])
    t.coordinator.onWindowCloseRequested(t.event())
    await tick()
    await tick()
    expect(t.askOnFailure).toHaveBeenCalledWith('unsaved-draft', 'close')
    expect(t.requestFlush.mock.calls.map((call) => call[0])).toEqual(['check', 'discard'])
    expect(t.continueClose).toHaveBeenCalledTimes(1)
    expect(t.continueQuit).not.toHaveBeenCalled()
  })

  it('保存してもWorkspace状態の保存に失敗した場合は、続けて既存の確認（再試行など）を行う', async () => {
    const t = setup(['unsaved-draft', 'failed', 'saved'], ['save', 'retry'])
    t.coordinator.onQuitRequested(t.event())
    for (let i = 0; i < 4; i++) await tick()
    expect(t.requestFlush.mock.calls.map((call) => call[0])).toEqual(['check', 'save', 'check'])
    expect(t.askOnFailure.mock.calls.map((call) => call[0])).toEqual(['unsaved-draft', 'failed'])
    expect(t.continueQuit).toHaveBeenCalledTimes(1)
  })

  it('保存して終了の処理中に終了要求が重なっても、保存・終了は1回だけ', async () => {
    let finishSave: (outcome: FlushCheckOutcome) => void = () => {}
    const requestFlush = vi.fn((action: string) =>
      action === 'save'
        ? new Promise<FlushCheckOutcome>((resolve) => (finishSave = resolve))
        : Promise.resolve<FlushCheckOutcome>('unsaved-draft')
    )
    const continueQuit = vi.fn()
    const coordinator = createExitCoordinator({
      requestFlush,
      askOnFailure: vi.fn(async () => 'save' as const),
      continueQuit,
      continueClose: vi.fn(),
      logger: silent
    })
    coordinator.onQuitRequested({ preventDefault: vi.fn() })
    await tick()
    for (let i = 0; i < 3; i++) coordinator.onQuitRequested({ preventDefault: vi.fn() })
    finishSave('saved')
    await tick()
    expect(requestFlush.mock.calls.map((call) => call[0])).toEqual(['check', 'save'])
    expect(continueQuit).toHaveBeenCalledTimes(1)
  })

  it('保存しない設定（disabled）やRendererなし（unavailable）では終了を妨げない', async () => {
    for (const outcome of ['disabled', 'unavailable'] as const) {
      const t = setup([outcome])
      t.coordinator.onQuitRequested(t.event())
      await tick()
      expect(t.askOnFailure).not.toHaveBeenCalled()
      expect(t.continueQuit).toHaveBeenCalledTimes(1)
    }
  })
})

describe('未保存の対象の種類（タスク名・プロジェクト名）と終了ダイアログ', () => {
  it('ダイアログの文言は対象と終了・閉じるの別で切り替える（対象不明はタスクのタイトル）', () => {
    expect(unsavedDraftDialogText('project', 'quit')).toMatchObject({
      buttons: ['保存して終了', '保存せずに終了', 'キャンセル'],
      message: 'プロジェクト名に未保存の変更があります'
    })
    expect(unsavedDraftDialogText('project', 'quit').detail).toContain('プロジェクト名の変更だけを破棄')
    expect(unsavedDraftDialogText('task', 'close')).toMatchObject({
      buttons: ['保存して閉じる', '保存せずに閉じる', 'キャンセル'],
      message: 'タスクのタイトルに未保存の変更があります'
    })
    expect(unsavedDraftDialogText(null, 'quit').message).toBe('タスクのタイトルに未保存の変更があります')
  })

  it('Rendererが project と応答すると、終了時のダイアログはプロジェクト名の文言になり、保存して終了まで進む', async () => {
    let n = 0
    const sent: { requestId: string; draftAction: DraftExitAction }[] = []
    const requester = createFlushRequester({ send: (request) => (sent.push(request), true), generateId: () => `req-${++n}` })
    const messages: string[] = []
    const continueQuit = vi.fn()
    const coordinator = createExitCoordinator({
      requestFlush: (action) => requester.request(action),
      askOnFailure: async (_outcome, kind) => {
        messages.push(unsavedDraftDialogText(requester.lastDraftKind(), kind).message)
        return 'save'
      },
      continueQuit,
      continueClose: () => {},
      logger: silent
    })
    coordinator.onQuitRequested({ preventDefault: () => {} })
    await tick()
    expect(sent.map((request) => request.draftAction)).toEqual(['check'])
    requester.resolve('req-1', 'unsaved-draft', 'project')
    await tick()
    expect(messages).toEqual(['プロジェクト名に未保存の変更があります'])
    expect(sent.map((request) => request.draftAction)).toEqual(['check', 'save'])
    requester.resolve('req-2', 'saved')
    await tick()
    expect(continueQuit).toHaveBeenCalledTimes(1)
  })
})

describe('保存確認の応答（IPC入力）の検証', () => {
  const id = '6f1c2f8e-3c1d-4f0a-9b7e-2a6d1f3c9e10'
  it('requestId（UUID）と既知の結果だけを受け付ける', () => {
    expect(workspaceFlushResultArgsSchema.safeParse([{ requestId: id, outcome: 'saved' }]).success).toBe(true)
    expect(workspaceFlushResultArgsSchema.safeParse([{ requestId: 'x', outcome: 'saved' }]).success).toBe(false)
    expect(workspaceFlushResultArgsSchema.safeParse([{ requestId: id, outcome: 'timeout' }]).success).toBe(false)
    expect(workspaceFlushResultArgsSchema.safeParse([{ requestId: id, outcome: 'saved', extra: 1 }]).success).toBe(false)
    expect(
      workspaceFlushResultArgsSchema.safeParse([{ requestId: id, outcome: 'unsaved-draft', draftKind: 'project' }]).success
    ).toBe(true)
    expect(
      workspaceFlushResultArgsSchema.safeParse([{ requestId: id, outcome: 'unsaved-draft', draftKind: 'other' }]).success
    ).toBe(false)
  })
})

describe('開発起動の親プロセスの監視（フェーズ5.9）', () => {
  it('親プロセスが変わったら1回だけ通知し、監視を止める（強制終了はしない）', () => {
    let ppid = 100
    let callback: () => void = () => {}
    const clearTimer = vi.fn()
    const onOrphaned = vi.fn()
    watchParentProcess({ getParentPid: () => ppid, onOrphaned, setTimer: (cb) => ((callback = cb), 'timer'), clearTimer })
    callback()
    expect(onOrphaned).not.toHaveBeenCalled()
    ppid = 1
    callback()
    callback()
    expect(onOrphaned).toHaveBeenCalledTimes(1)
    expect(onOrphaned).toHaveBeenCalledWith({ initialParentPid: 100, currentParentPid: 1 })
    expect(clearTimer).toHaveBeenCalledWith('timer')
  })

  it('stop() で監視を止める（終了時）。二重に止めても問題ない', () => {
    const clearTimer = vi.fn()
    const watcher = watchParentProcess({ getParentPid: () => 5, onOrphaned: vi.fn(), setTimer: () => 'timer', clearTimer })
    watcher.stop()
    watcher.stop()
    expect(clearTimer).toHaveBeenCalledTimes(1)
  })
})
