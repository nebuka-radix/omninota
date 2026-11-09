// 終了前の問い合わせ1件の処理手順。DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。
import type { DraftExitAction, WorkspaceFlushOutcome } from '../../../../shared/contracts/ipc'

export type DraftExitHandlers = {
  isDirty: () => boolean
  // 保存に成功したらtrue。失敗・無効な入力ならfalse（ドラフトと理由は画面に残る）
  save: () => Promise<boolean>
  discard: () => void
}

export async function processFlushRequest(
  draftAction: DraftExitAction,
  deps: {
    draft: DraftExitHandlers | null
    // Workspace状態の保存キューのflush。WorkspaceProviderがなければnull
    flushWorkspace: (() => Promise<WorkspaceFlushOutcome>) | null
    // 直前の操作で確定した値が保存キューに入るのを待つ
    waitForPendingCommits: () => Promise<void>
  }
): Promise<WorkspaceFlushOutcome> {
  const { draft } = deps
  if (draftAction === 'save' && draft?.isDirty()) {
    // 保存するのは問い合わせ時点のドラフト。保存中は入力欄が読み取り専用になる
    if (!(await draft.save())) return 'draft-save-failed'
  } else if (draftAction === 'discard' && draft?.isDirty()) {
    // 「保存せずに」はドラフトの破棄だけ。Workspace状態の保存確認は続けて行う
    draft.discard()
  }

  await deps.waitForPendingCommits()
  const outcome = deps.flushWorkspace ? await deps.flushWorkspace() : 'nothing'
  // Workspace状態の保存に問題がなければ、未保存ドラフトの有無を伝える（確認はMain側の同じダイアログで行う）
  if (outcome !== 'failed' && draft?.isDirty()) return 'unsaved-draft'
  return outcome
}
