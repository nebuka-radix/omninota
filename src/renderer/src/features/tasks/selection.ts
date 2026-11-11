// Inboxの複数選択（フェーズ5.9）。DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。
// - 選択集合（ids）と範囲選択の基準行（anchorId）を持つ。現在行（キーボードのフォーカス行）は一覧の部品が持つ。
// - 順序（order）は現在の表示順（絞り込み・並べ替え後のタスクID）。選択はデータのIDで持つため、
//   仮想化で行要素がアンマウントされても失われない。
// - 表示対象から外れたID（絞り込み・削除・紐付けなど）は prune で取り除き、見えない対象に一括操作を行わない。
export type TaskSelection = {
  ids: ReadonlySet<string>
  anchorId: string | null
}

export const EMPTY_SELECTION: TaskSelection = { ids: new Set(), anchorId: null }

// 単一選択（通常のクリック・Enter）
export function selectOnly(id: string): TaskSelection {
  return { ids: new Set([id]), anchorId: id }
}

// 追加・解除（⌘+クリック、キーボードは X）。基準行はその行にする
export function toggleSelection(state: TaskSelection, id: string): TaskSelection {
  const ids = new Set(state.ids)
  if (ids.has(id)) ids.delete(id)
  else ids.add(id)
  return { ids, anchorId: id }
}

// 範囲選択（Shift+クリック、Shift+↑↓）。基準行から指定行までを、現在の表示順で選ぶ（基準行は変えない）。
// 基準行がない・表示されていない場合は、指定行を基準にする
export function selectRange(state: TaskSelection, id: string, order: readonly string[]): TaskSelection {
  const to = order.indexOf(id)
  if (to < 0) return state
  const anchorId = state.anchorId !== null && order.includes(state.anchorId) ? state.anchorId : id
  const from = order.indexOf(anchorId)
  const [start, end] = from <= to ? [from, to] : [to, from]
  return { ids: new Set(order.slice(start, end + 1)), anchorId }
}

// すべて選択（⌘A）。表示中のタスクだけ
export function selectAll(order: readonly string[]): TaskSelection {
  return { ids: new Set(order), anchorId: order[0] ?? null }
}

// 表示対象にないIDを取り除く。変わらなければ同じオブジェクトを返す（再描画を増やさない）
export function pruneSelection(state: TaskSelection, visibleIds: ReadonlySet<string>): TaskSelection {
  let changed = false
  const ids = new Set<string>()
  for (const id of state.ids) {
    if (visibleIds.has(id)) ids.add(id)
    else changed = true
  }
  const anchorId = state.anchorId !== null && visibleIds.has(state.anchorId) ? state.anchorId : null
  if (!changed && anchorId === state.anchorId) return state
  return { ids, anchorId }
}

// 指定したIDを選択から外す（一括操作の成功後）
export function removeFromSelection(state: TaskSelection, removed: ReadonlySet<string>): TaskSelection {
  const ids = new Set([...state.ids].filter((id) => !removed.has(id)))
  const anchorId = state.anchorId !== null && removed.has(state.anchorId) ? null : state.anchorId
  return { ids, anchorId }
}

// 操作の対象。起点の行（ドラッグした行・現在行・メニューを開いた行）が選択集合に含まれていれば、
// 選択集合のうち表示中のもの（表示順）。含まれていなければ、その行だけ（選択は変えない）
export function operationTargets(state: TaskSelection, originId: string, order: readonly string[]): string[] {
  if (!state.ids.has(originId)) return [originId]
  return order.filter((id) => state.ids.has(id))
}

// 行が一覧から消えた（一括紐付け・削除）後の移り先。消える前の位置（previousIndex）から後ろへ探した最初の残りの行、
// 後ろになければ前へ探した最初の残りの行。残っている行がなければ null
export function nearestRemaining(previousOrder: readonly string[], removed: ReadonlySet<string>, previousIndex: number): string | null {
  for (let index = Math.max(0, previousIndex); index < previousOrder.length; index++) {
    const id = previousOrder[index]
    if (id !== undefined && !removed.has(id)) return id
  }
  for (let index = Math.min(previousIndex, previousOrder.length) - 1; index >= 0; index--) {
    const id = previousOrder[index]
    if (id !== undefined && !removed.has(id)) return id
  }
  return null
}
