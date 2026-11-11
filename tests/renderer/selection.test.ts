// フェーズ5.9: Inboxの複数選択（ホストNode.js）
import { describe, expect, it } from 'vitest'
import {
  EMPTY_SELECTION,
  nearestRemaining,
  operationTargets,
  pruneSelection,
  removeFromSelection,
  selectAll,
  selectOnly,
  selectRange,
  toggleSelection
} from '../../src/renderer/src/features/tasks/selection'

const order = ['a', 'b', 'c', 'd', 'e']
const ids = (state: { ids: ReadonlySet<string> }) => [...state.ids].sort()

describe('複数選択', () => {
  it('単一選択・追加／解除（⌘）・範囲（Shift）', () => {
    const one = selectOnly('b')
    expect(ids(one)).toEqual(['b'])
    const added = toggleSelection(one, 'd')
    expect(ids(added)).toEqual(['b', 'd'])
    expect(added.anchorId).toBe('d')
    expect(ids(toggleSelection(added, 'b'))).toEqual(['d'])
    // 範囲は基準行（最後に単一選択・追加した行）から、現在の表示順で選ぶ
    expect(ids(selectRange(one, 'd', order))).toEqual(['b', 'c', 'd'])
    expect(ids(selectRange(one, 'a', order))).toEqual(['a', 'b'])
    // 範囲選択を続けても基準行は変えない
    const range = selectRange(one, 'e', order)
    expect(range.anchorId).toBe('b')
    expect(ids(selectRange(range, 'c', order))).toEqual(['b', 'c'])
    // 基準行がない・表示されていなければ、指定行から
    expect(ids(selectRange(EMPTY_SELECTION, 'c', order))).toEqual(['c'])
    expect(ids(selectRange({ ids: new Set(), anchorId: 'zz' }, 'c', order))).toEqual(['c'])
    expect(ids(selectAll(order))).toEqual(order)
  })

  it('表示対象から外れたIDは取り除く（変わらなければ同じオブジェクト）', () => {
    const state = { ids: new Set(['a', 'c', 'e']), anchorId: 'e' }
    const pruned = pruneSelection(state, new Set(['a', 'b', 'c']))
    expect(ids(pruned)).toEqual(['a', 'c'])
    expect(pruned.anchorId).toBeNull()
    expect(pruneSelection(state, new Set(order))).toBe(state)
  })

  it('操作の対象: 起点が選択に含まれれば表示中の選択（表示順）、含まれなければ起点だけ', () => {
    const state = { ids: new Set(['d', 'b', 'zz']), anchorId: 'b' }
    expect(operationTargets(state, 'd', order)).toEqual(['b', 'd'])
    expect(operationTargets(state, 'a', order)).toEqual(['a'])
    expect(ids(removeFromSelection(state, new Set(['b'])))).toEqual(['d', 'zz'])
    expect(removeFromSelection(state, new Set(['b'])).anchorId).toBeNull()
  })

  it('消えた行の移り先は、元の位置に最も近い残りの行（後ろを優先）', () => {
    expect(nearestRemaining(order, new Set(['b', 'c']), 1)).toBe('d')
    expect(nearestRemaining(order, new Set(['d', 'e']), 3)).toBe('c')
    expect(nearestRemaining(order, new Set(order), 2)).toBeNull()
  })
})
