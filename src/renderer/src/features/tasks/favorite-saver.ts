// お気に入り（星）の保存の順序制御。DOM・React に依存しない（ホストNode.jsのテストで検証する）。
// - 押すたびに「目的の状態」を反転し、画面はすぐ目的の状態を表示する（押した結果が分かるようにする）。
// - 保存は同じタスクの保存キュー（タイトル・期限・所属・削除と順番）に並べる。送る値は実行の時点の目的の状態。
//   保存中に何度押されても、待っている保存は1つだけ（実行の時点で最新の目的の状態を送る）。
//   保存が終わった時点で目的の状態が送った値と違えば、もう1回だけ保存する（最後に押した状態が必ず保存される）。
// - 成功した応答（保存後のタスク全体）は onSaved へ渡す（一覧キャッシュの置き換え）。お気に入り以外の項目は Main が変えない。
// - 失敗したら目的の状態を捨て、画面は保存済みの値（キャッシュ）へ戻す。理由は onError へ渡す（呼び出し側が表示し、一覧を取り直す）。
// - 削除済みのタスク（Main が NOT_FOUND）は作り直さない。
export type FavoriteSaver<T> = {
  // 表示する値（保存待ち・保存中なら目的の状態。なければ undefined＝保存済みの値を使う）
  desired(taskId: string): boolean | undefined
  toggle(taskId: string, saved: boolean): void
  subscribe(listener: () => void): () => void
  // 変更のたびに増える値（useSyncExternalStore の比較用）
  version(): number
}

export function createFavoriteSaver<T>(deps: {
  enqueue: (taskId: string, save: () => Promise<T>) => Promise<T>
  save: (taskId: string, favorite: boolean) => Promise<T>
  onSaved: (result: T) => void
  onError: (taskId: string, error: unknown) => void
}): FavoriteSaver<T> {
  const desired = new Map<string, boolean>()
  // 保存キューに並んでいる（実行待ち・実行中）タスク
  const queued = new Set<string>()
  const listeners = new Set<() => void>()
  let version = 0
  const notify = () => {
    version += 1
    for (const listener of listeners) listener()
  }

  const pump = (taskId: string) => {
    queued.add(taskId)
    let sent: boolean | undefined
    deps
      .enqueue(taskId, () => {
        sent = desired.get(taskId)
        // 実行の時点で目的の状態がない（失敗で捨てた後など）なら送らない
        if (sent === undefined) return Promise.resolve(undefined as T)
        return deps.save(taskId, sent)
      })
      .then(
        (result) => {
          queued.delete(taskId)
          if (sent === undefined) return
          deps.onSaved(result)
          if (desired.get(taskId) === sent) desired.delete(taskId)
          else if (desired.has(taskId)) pump(taskId)
          notify()
        },
        (error: unknown) => {
          queued.delete(taskId)
          desired.delete(taskId)
          deps.onError(taskId, error)
          notify()
        }
      )
  }

  return {
    desired: (taskId) => desired.get(taskId),
    toggle(taskId, saved) {
      const next = !(desired.get(taskId) ?? saved)
      desired.set(taskId, next)
      notify()
      if (!queued.has(taskId)) pump(taskId)
    },
    version: () => version,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
