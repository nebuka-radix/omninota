import { useSyncExternalStore } from 'react'

// Summary Review の右サイドバーのプロジェクトのフィルター（表示だけ。タスク・プロジェクトのデータは変えない）。
// - 状態は「OFF にしたプロジェクトのID」だけを持つ（新しく追加されたプロジェクトは初期 ON）。
// - アプリのセッション中（Renderer のモジュールの状態）だけ保持する。他の画面へ移って戻っても残り、再起動するとすべて ON に戻る。
//   DB・Workspace設定へは保存しない。他の画面のプロジェクト一覧・フィルターには影響しない。
let excluded: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function set(next: ReadonlySet<string>) {
  excluded = next
  for (const listener of listeners) listener()
}

export const summaryProjectFilter = {
  excluded: () => excluded,
  setOn(projectId: string, on: boolean) {
    if (on === !excluded.has(projectId)) return
    const next = new Set(excluded)
    if (on) next.delete(projectId)
    else next.add(projectId)
    set(next)
  },
  // 存在しなくなったプロジェクト（削除）の ID を外す
  prune(existingIds: readonly string[]) {
    const existing = new Set(existingIds)
    if ([...excluded].every((id) => existing.has(id))) return
    set(new Set([...excluded].filter((id) => existing.has(id))))
  },
  // テスト用（初期状態へ戻す）
  reset() {
    set(new Set())
  },
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}

export function useSummaryExcludedProjects(): ReadonlySet<string> {
  return useSyncExternalStore(summaryProjectFilter.subscribe, summaryProjectFilter.excluded)
}
