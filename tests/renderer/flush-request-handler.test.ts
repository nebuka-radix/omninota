import { describe, expect, it, vi } from 'vitest'
import { processFlushRequest, type DraftExitHandlers } from '../../src/renderer/src/features/workspace/flush-request-handler'

function createDraft(options: { dirty: boolean; saveOk?: boolean }) {
  let dirty = options.dirty
  const handlers: DraftExitHandlers = {
    isDirty: () => dirty,
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

const deps = (draft: DraftExitHandlers | null, workspace: 'saved' | 'nothing' | 'failed' = 'nothing') => {
  const order: string[] = []
  return {
    order,
    deps: {
      draft,
      flushWorkspace: vi.fn(async () => (order.push('workspace'), workspace)),
      waitForPendingCommits: vi.fn(async () => {
        order.push('wait')
      })
    }
  }
}

describe('終了前の問い合わせの処理（Renderer）', () => {
  it('確認（check）: ドラフトがあれば変えずに unsaved-draft を返す', async () => {
    const draft = createDraft({ dirty: true })
    const { deps: d } = deps(draft, 'saved')
    expect(await processFlushRequest('check', d)).toBe('unsaved-draft')
    expect(draft.save).not.toHaveBeenCalled()
    expect(draft.discard).not.toHaveBeenCalled()
  })

  it('保存（save）: タイトルを保存してから、確定済みの値を待ってWorkspace状態を保存する', async () => {
    const draft = createDraft({ dirty: true })
    const { deps: d, order } = deps(draft, 'saved')
    expect(await processFlushRequest('save', d)).toBe('saved')
    expect(draft.save).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['wait', 'workspace'])
  })

  it('保存（save）に失敗・無効な入力なら draft-save-failed（Workspace状態の確認へ進まない）', async () => {
    const draft = createDraft({ dirty: true, saveOk: false })
    const { deps: d } = deps(draft)
    expect(await processFlushRequest('save', d)).toBe('draft-save-failed')
    expect(d.flushWorkspace).not.toHaveBeenCalled()
    expect(draft.isDirty()).toBe(true) // ドラフトは残る
  })

  it('破棄（discard）: タイトルは保存せず、Workspace状態の保存は省略しない', async () => {
    const draft = createDraft({ dirty: true })
    const { deps: d } = deps(draft, 'saved')
    expect(await processFlushRequest('discard', d)).toBe('saved')
    expect(draft.save).not.toHaveBeenCalled()
    expect(draft.discard).toHaveBeenCalledTimes(1)
    expect(d.flushWorkspace).toHaveBeenCalledTimes(1)
  })

  it('Workspace状態の保存に失敗したら failed を優先する', async () => {
    const { deps: d } = deps(createDraft({ dirty: true }), 'failed')
    expect(await processFlushRequest('check', d)).toBe('failed')
  })

  it('ドラフトもWorkspaceProviderもなければ nothing', async () => {
    expect(
      await processFlushRequest('save', { draft: null, flushWorkspace: null, waitForPendingCommits: async () => {} })
    ).toBe('nothing')
  })
})
