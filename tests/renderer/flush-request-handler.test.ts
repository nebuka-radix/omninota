import { describe, expect, it, vi } from 'vitest'
import { processFlushRequest, type DraftExitHandlers } from '../../src/renderer/src/features/workspace/flush-request-handler'

function createDraft(options: { dirty: boolean; saveOk?: boolean; kind?: 'task' | 'project' }) {
  let dirty = options.dirty
  const handlers: DraftExitHandlers = {
    isDirty: () => dirty,
    kind: () => (dirty ? (options.kind ?? 'task') : null),
    save: vi.fn(async () => {
      if (options.saveOk === false) return false
      dirty = false
      return true
    }),
    discard: vi.fn(() => {
      dirty = false
    })
  }
  return handlers
}

const deps = (
  draft: DraftExitHandlers | null,
  workspace: 'saved' | 'nothing' | 'failed' = 'nothing',
  taskSavesOk = true
) => {
  const order: string[] = []
  return {
    order,
    deps: {
      draft,
      flushWorkspace: vi.fn(async () => (order.push('workspace'), workspace)),
      waitForPendingCommits: vi.fn(async () => {
        order.push('wait')
      }),
      waitForTaskSaves: vi.fn(async () => (order.push('task-saves'), taskSavesOk))
    }
  }
}

describe('終了前の問い合わせの処理（Renderer）', () => {
  it('確認（check）: ドラフトがあれば変えずに unsaved-draft を返す', async () => {
    const draft = createDraft({ dirty: true })
    const { deps: d } = deps(draft, 'saved')
    expect(await processFlushRequest('check', d)).toEqual({ outcome: 'unsaved-draft', draftKind: 'task' })
    expect(draft.save).not.toHaveBeenCalled()
    expect(draft.discard).not.toHaveBeenCalled()
  })

  it('保存（save）: タイトルを保存してから、確定済みの値を待ってWorkspace状態を保存する', async () => {
    const draft = createDraft({ dirty: true })
    const { deps: d, order } = deps(draft, 'saved')
    expect(await processFlushRequest('save', d)).toEqual({ outcome: 'saved' })
    expect(draft.save).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['task-saves', 'wait', 'workspace'])
  })

  it('保存（save）に失敗・無効な入力なら draft-save-failed（Workspace状態の確認へ進まない）', async () => {
    const draft = createDraft({ dirty: true, saveOk: false })
    const { deps: d } = deps(draft)
    expect(await processFlushRequest('save', d)).toEqual({ outcome: 'draft-save-failed', draftKind: 'task' })
    expect(d.flushWorkspace).not.toHaveBeenCalled()
    expect(draft.isDirty()).toBe(true) // ドラフトは残る
  })

  it('破棄（discard）: タイトルは保存せず、Workspace状態の保存は省略しない', async () => {
    const draft = createDraft({ dirty: true })
    const { deps: d } = deps(draft, 'saved')
    expect(await processFlushRequest('discard', d)).toEqual({ outcome: 'saved' })
    expect(draft.save).not.toHaveBeenCalled()
    expect(draft.discard).toHaveBeenCalledTimes(1)
    expect(d.flushWorkspace).toHaveBeenCalledTimes(1)
  })

  it('Workspace状態の保存に失敗したら failed を優先する', async () => {
    const { deps: d } = deps(createDraft({ dirty: true }), 'failed')
    expect(await processFlushRequest('check', d)).toEqual({ outcome: 'failed' })
  })

  it('ドラフトもWorkspaceProviderもなければ nothing', async () => {
    expect(
      await processFlushRequest('save', {
        draft: null,
        flushWorkspace: null,
        waitForPendingCommits: async () => {},
        waitForTaskSaves: async () => true
      })
    ).toEqual({ outcome: 'nothing' })
  })

  it('プロジェクト名のドラフトなら対象を project として伝える（終了時のダイアログの文言用）', async () => {
    const draft = createDraft({ dirty: true, kind: 'project' })
    const { deps: d } = deps(draft, 'saved')
    expect(await processFlushRequest('check', d)).toEqual({ outcome: 'unsaved-draft', draftKind: 'project' })
    expect(await processFlushRequest('save', d)).toEqual({ outcome: 'saved' })
  })

  it('進行中のタスクの保存（所属の変更など）を待ってから応答する。失敗していれば続行しない（draft-save-failed）', async () => {
    const ok = deps(null, 'saved')
    expect(await processFlushRequest('check', ok.deps)).toEqual({ outcome: 'saved' })
    expect(ok.order).toEqual(['task-saves', 'wait', 'workspace'])

    const failed = deps(null, 'saved', false)
    expect(await processFlushRequest('check', failed.deps)).toEqual({ outcome: 'draft-save-failed' })
    expect(failed.deps.flushWorkspace).not.toHaveBeenCalled()

    // タイトルのドラフトがある場合は、その対象を伝える（ドラフトは保存も破棄もしない）
    const draft = createDraft({ dirty: true })
    const withDraft = deps(draft, 'saved', false)
    expect(await processFlushRequest('save', withDraft.deps)).toEqual({ outcome: 'draft-save-failed', draftKind: 'task' })
    expect(draft.save).not.toHaveBeenCalled()
    expect(draft.discard).not.toHaveBeenCalled()
  })
})
