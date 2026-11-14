// 保存要求を1件ずつ順番に送り、待機中は最新の値だけを残す。
// これにより、遅れて完了した古い保存が新しい値を上書きすることはない
// （IPCはMain側で到着順に同期処理されるため、送信順＝保存順になる）。
// Reactに依存しないので、ホストNode.jsのテストから検証できる。

export type SaveStatus = 'idle' | 'saving' | 'error'

// flush の結果
// - saved: 最新の確定値を保存できた
// - failed: 最新の確定値の保存に失敗した
// - nothing: 保存すべき値がない（未保存の変更なし）
export type FlushResult = 'saved' | 'failed' | 'nothing'

export type LatestWinsSaver<T> = {
  schedule(value: T): void
  // 待機中・送信中の保存が終わるまで待つ。直前の保存が失敗していれば、その値を再送する。
  flush(): Promise<FlushResult>
  dispose(): void
}

export function createLatestWinsSaver<T>(options: {
  save: (value: T) => Promise<void>
  onStatusChange: (status: SaveStatus, error?: unknown) => void
}): LatestWinsSaver<T> {
  let pending: { value: T } | null = null
  // 最後に保存に失敗した値（その後に成功すれば消える）
  let failed: { value: T } | null = null
  let running: Promise<void> | null = null
  let disposed = false

  const run = async () => {
    let lastError: unknown = undefined
    while (pending && !disposed) {
      const item = pending
      pending = null
      options.onStatusChange('saving')
      try {
        await options.save(item.value)
        lastError = undefined
        failed = null
      } catch (error) {
        lastError = error
        failed = item
      }
    }
    if (disposed) return
    if (lastError !== undefined) options.onStatusChange('error', lastError)
    else options.onStatusChange('idle')
  }

  const start = () => {
    if (running) return
    running = run().finally(() => {
      running = null
      // 実行の終了直前に届いた要求を取りこぼさない
      if (pending && !disposed) start()
    })
  }

  return {
    schedule(value) {
      if (disposed) return
      pending = { value }
      start()
    },
    async flush() {
      if (disposed) return 'nothing'
      if (!running && !pending) {
        if (!failed) return 'nothing'
        pending = failed
      }
      start()
      while (running) {
        await running
      }
      return failed ? 'failed' : 'saved'
    },
    dispose() {
      disposed = true
      pending = null
    }
  }
}
