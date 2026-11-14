// 終了前の問い合わせ1件の処理手順。DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。
import type { DraftExitAction, DraftKind, WorkspaceFlushOutcome } from '../../../../shared/contracts/ipc'

export type DraftExitHandlers = {
  isDirty: () => boolean
  // 未保存ドラフトの対象（タスクのタイトル・プロジェクト名）。なければnull
  kind: () => DraftKind | null
  // 保存に成功したらtrue。失敗・無効な入力ならfalse（ドラフトと理由は画面に残る）
  save: () => Promise<boolean>
  discard: () => void
  // 編集欄で進行中の保存の後処理まで待つ（未保存の有無を正しく判定するため。フェーズ5.3）
  settle: () => Promise<void>
}

export type FlushResponse = { outcome: WorkspaceFlushOutcome; draftKind?: DraftKind }

export async function processFlushRequest(
  draftAction: DraftExitAction,
  deps: {
    draft: DraftExitHandlers | null
    // Workspace状態の保存キューのflush。WorkspaceProviderがなければnull
    flushWorkspace: (() => Promise<WorkspaceFlushOutcome>) | null
    // 直前の操作で確定した値が保存キューに入るのを待つ
    waitForPendingCommits: () => Promise<void>
    // 進行中のタスクの保存（所属の変更など）の完了を待つ。1つでも失敗していればfalse（フェーズ5.2）
    waitForTaskSaves: () => Promise<boolean>
  }
): Promise<FlushResponse> {
  const { draft } = deps
  const withKind = (outcome: WorkspaceFlushOutcome): FlushResponse => {
    const kind = draft?.kind() ?? null
    return kind ? { outcome, draftKind: kind } : { outcome }
  }

  // 進行中の保存が失敗した場合は続行しない（理由は画面に表示されている。黙って終了しない）
  if (!(await deps.waitForTaskSaves())) return withKind('draft-save-failed')
  await draft?.settle()

  if (draftAction === 'save' && draft?.isDirty()) {
    // 保存するのは問い合わせ時点のドラフト。保存中は入力欄が読み取り専用になる
    if (!(await draft.save())) return withKind('draft-save-failed')
  } else if (draftAction === 'discard' && draft?.isDirty()) {
    // 「保存せずに」はドラフトの破棄だけ。Workspace状態の保存確認は続けて行う
    draft.discard()
  }

  await deps.waitForPendingCommits()
  const outcome = deps.flushWorkspace ? await deps.flushWorkspace() : 'nothing'
  // Workspace状態の保存に問題がなければ、未保存ドラフトの有無を伝える（確認はMain側の同じダイアログで行う）
  if (outcome !== 'failed' && draft?.isDirty()) return withKind('unsaved-draft')
  return { outcome }
}
