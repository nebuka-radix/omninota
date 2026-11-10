// 同じタスクへの更新（タイトル・完了状態・所属）を順番に1つずつ実行する（フェーズ5.2）。
// フェーズ5.3から、同じプロジェクトの更新（名前・完了状態）も、キー projectSaveKey(id) で同じ仕組みを使う。
// DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。
// - 各更新は「保存後のタスク全体」を返すため、順番に実行すれば、後から届いた応答が常に最新の状態になる
//   （古い応答で、別の項目の新しい値を上書きしない）。
// - 別のタスクの更新は待たない。
// - waitForIdle: 呼び出した時点で進行中・順番待ちの更新がすべて終わるまで待つ。1つでも失敗していればfalse。
//   別タスクの選択・画面遷移・終了の前に使い、進行中の保存を黙って失わせない。
export type TaskSaveQueue = {
  run<T>(taskId: string, save: () => Promise<T>): Promise<T>
  waitForIdle(): Promise<boolean>
}

export function createTaskSaveQueue(): TaskSaveQueue {
  // タスクごとの最後の更新（成否を true / false にした、失敗しないPromise）
  const tails = new Map<string, Promise<boolean>>()
  const pending = new Set<Promise<boolean>>()

  return {
    run(taskId, save) {
      const previous = tails.get(taskId) ?? Promise.resolve(true)
      // 前の更新の成否によらず、終わってから実行する
      const result = previous.then(() => save())
      const settled = result.then(
        () => true,
        () => false
      )
      tails.set(taskId, settled)
      pending.add(settled)
      void settled.then(() => {
        pending.delete(settled)
        if (tails.get(taskId) === settled) tails.delete(taskId)
      })
      return result
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
