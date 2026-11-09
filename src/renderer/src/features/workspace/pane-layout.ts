// 希望幅（保存する値）から実寸（表示する値）を計算する。Reactに依存しない純粋な関数。
import { clampWidth, WORKSPACE_LIMITS } from '../../../../shared/contracts/workspace'

export type PaneKey = 'sidebar' | 'detail'

export type PaneWidths = {
  sidebar: number
  main: number
  // 詳細パネル非表示の場合はnull
  detail: number | null
}

// available: 3つのパネルに配分できる幅（Groupの幅から境界線の幅を除いたもの）
// priority: 幅が足りない時に縮めない側（直前にユーザーが操作したペイン）
export function computePaneWidths(input: {
  available: number
  sidebarPreferred: number
  detailPreferred: number | null
  priority: PaneKey
}): PaneWidths {
  const { sidebarWidth: SIDEBAR, detailWidth: DETAIL, mainMinWidth } = WORKSPACE_LIMITS
  let sidebar = clampWidth(input.sidebarPreferred, SIDEBAR)
  let detail = input.detailPreferred === null ? null : clampWidth(input.detailPreferred, DETAIL)

  // メインパネルの最小幅を確保できない分を、優先しない側 → 優先する側の順に最小幅まで縮める。
  let shortage = sidebar + (detail ?? 0) + mainMinWidth - input.available
  const shrink = (pane: PaneKey) => {
    if (shortage <= 0) return
    if (pane === 'sidebar') {
      const amount = Math.min(shortage, sidebar - SIDEBAR.min)
      sidebar -= amount
      shortage -= amount
    } else if (detail !== null) {
      const amount = Math.min(shortage, detail - DETAIL.min)
      detail -= amount
      shortage -= amount
    }
  }
  const other: PaneKey = input.priority === 'sidebar' ? 'detail' : 'sidebar'
  shrink(other)
  shrink(input.priority)

  // それでも足りない場合（ウィンドウ最小幅未満）は、メインパネルが最小幅を下回る。
  return { sidebar, main: input.available - sidebar - (detail ?? 0), detail }
}

// 操作した境界線が分からない場合の判定。ライブラリは境界線の隣のペインを優先して動かし、
// メインパネルが最小幅に達すると反対側のペインを縮める。両方変わった時は広がった側が操作対象。
export function inferOperatedPane(
  before: { sidebar: number; detail: number | null },
  after: { sidebar: number; detail: number | null },
  tolerance = 1
): PaneKey | null {
  const sidebarDelta = after.sidebar - before.sidebar
  const detailDelta = before.detail !== null && after.detail !== null ? after.detail - before.detail : 0
  const sidebarChanged = Math.abs(sidebarDelta) > tolerance
  const detailChanged = Math.abs(detailDelta) > tolerance
  if (sidebarChanged && !detailChanged) return 'sidebar'
  if (detailChanged && !sidebarChanged) return 'detail'
  if (sidebarChanged && detailChanged) return sidebarDelta > 0 ? 'sidebar' : 'detail'
  return null
}
