// 同じタスクへの更新（タイトル・完了状態・所属）を順番に1つずつ実行する（フェーズ5.2）。
// フェーズ5.3から、同じプロジェクトの更新（名前・完了状態）も、キー projectSaveKey(id) で同じ仕組みを使う。
// DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。
// - 各更新は「保存後のタスク全体」を返すため、順番に実行すれば、後から届いた応答が常に最新の状態になる
//   （古い応答で、別の項目の新しい値を上書きしない）。
// - 別のタスクの更新は待たない。
// - waitForIdle: 呼び出した時点で進行中・順番待ちの更新がすべて終わるまで待つ。1つでも失敗していればfalse。
//   別タスクの選択・画面遷移・終了の前に使い、進行中の保存を黙って失わせない。
// - runMany（フェーズ5.9）: 複数タスクの一括操作（一括紐付け・一括削除・並べ替え）。対象すべての進行中の更新が終わってから1回だけ実行し、
//   その間に届いた各タスクの更新は、一括操作の後に実行する（一括削除の後に、遅れた更新が対象を変えることはない）。
export type TaskSaveQueue = {
  run<T>(taskId: string, save: () => Promise<T>): Promise<T>
  runMany<T>(taskIds: readonly string[], save: () => Promise<T>): Promise<T>
  waitForIdle(): Promise<boolean>
}

export function createTaskSaveQueue(): TaskSaveQueue {
  // タスクごとの最後の更新（成否を true / false にした、失敗しないPromise）
  const tails = new Map<string, Promise<boolean>>()
  const pending = new Set<Promise<boolean>>()

  const enqueue = <T>(taskIds: readonly string[], save: () => Promise<T>): Promise<T> => {
    const keys = [...new Set(taskIds)]
    const previous = Promise.all(keys.map((key) => tails.get(key) ?? Promise.resolve(true)))
    // 前の更新の成否によらず、終わってから実行する
    const result = previous.then(() => save())
    const settled = result.then(
      () => true,
      () => false
    )
    for (const key of keys) tails.set(key, settled)
    pending.add(settled)
    void settled.then(() => {
      pending.delete(settled)
      for (const key of keys) if (tails.get(key) === settled) tails.delete(key)
    })
    return result
  }

  return {
    run(taskId, save) {
      return enqueue([taskId], save)
    },
    runMany(taskIds, save) {
      return enqueue(taskIds, save)
    },
    async waitForIdle() {
      const results = await Promise.all([...pending])
      return results.every(Boolean)
    }
  }
}

// プロジェクトの更新に使うキー（タスクID（UUID）とは重ならない）
export function projectSaveKey(projectId: string): string {
  return `project:${projectId}`
}

// アプリ全体で1つ（Renderer内のモジュール状態）
export const taskSaveQueue = createTaskSaveQueue()
