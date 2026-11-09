import { describe, expect, it } from 'vitest'
import { createLatestWinsSaver, type SaveStatus } from '../../src/renderer/src/features/workspace/latest-wins-saver'

// 手動で完了させられる保存処理（遅延した保存を再現する）
function createControlledSave() {
  const calls: { value: number; resolve: () => void; reject: (error: Error) => void }[] = []
  const save = (value: number) =>
    new Promise<void>((resolve, reject) => {
      calls.push({ value, resolve, reject })
    })
  return { calls, save }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('最新値だけを順番に保存するキュー', () => {
  it('保存中に届いた複数の要求は、最後の値だけを次に保存する', async () => {
    const { calls, save } = createControlledSave()
    const statuses: SaveStatus[] = []
    const saver = createLatestWinsSaver({ save, onStatusChange: (status) => statuses.push(status) })

    saver.schedule(1)
    saver.schedule(2)
    saver.schedule(3)
    await flush()
    expect(calls.map((call) => call.value)).toEqual([1]) // 同時に送るのは1件だけ

    calls[0]?.resolve()
    await flush()
    expect(calls.map((call) => call.value)).toEqual([1, 3]) // 2 は送らない

    calls[1]?.resolve()
    await flush()
    expect(statuses.at(-1)).toBe('idle')
  })

  it('最後の保存が失敗したらerror、その後の保存が成功したらidleに戻る', async () => {
    const { calls, save } = createControlledSave()
    const statuses: SaveStatus[] = []
    const saver = createLatestWinsSaver({ save, onStatusChange: (status) => statuses.push(status) })

    saver.schedule(1)
    await flush()
    calls[0]?.reject(new Error('失敗'))
    await flush()
    expect(statuses.at(-1)).toBe('error')

    saver.schedule(2)
    await flush()
    calls[1]?.resolve()
    await flush()
    expect(statuses.at(-1)).toBe('idle')
  })

  it('dispose後は新しい要求を送らない', async () => {
    const { calls, save } = createControlledSave()
    const saver = createLatestWinsSaver({ save, onStatusChange: () => {} })
    saver.schedule(1)
    await flush()
    saver.schedule(2)
    saver.dispose()
    calls[0]?.resolve()
    await flush()
    saver.schedule(3)
    await flush()
    expect(calls.map((call) => call.value)).toEqual([1])
  })
})

describe('終了前のflush', () => {
  it('未保存の変更がなければ nothing', async () => {
    const { save } = createControlledSave()
    const saver = createLatestWinsSaver({ save, onStatusChange: () => {} })
    expect(await saver.flush()).toBe('nothing')
  })

  it('送信中・待機中の保存が終わるまで待ち、最新値を保存してから saved', async () => {
    const { calls, save } = createControlledSave()
    const saver = createLatestWinsSaver({ save, onStatusChange: () => {} })
    saver.schedule(1)
    saver.schedule(2) // 1 の送信中に届いた最新値
    let settled: string | null = null
    const flushing = saver.flush().then((result) => {
      settled = result
    })
    await flush()
    expect(settled).toBeNull() // 1 がまだ完了していない
    calls[0]?.resolve()
    await flush()
    expect(settled).toBeNull() // 2 を送信中
    expect(calls.map((call) => call.value)).toEqual([1, 2])
    calls[1]?.resolve()
    await flushing
    expect(settled).toBe('saved')
  })

  it('flush中に届いた値も保存してから終わる', async () => {
    const { calls, save } = createControlledSave()
    const saver = createLatestWinsSaver({ save, onStatusChange: () => {} })
    saver.schedule(1)
    const flushing = saver.flush()
    await flush()
    saver.schedule(5)
    calls[0]?.resolve()
    await flush()
    calls[1]?.resolve()
    expect(await flushing).toBe('saved')
    expect(calls.map((call) => call.value)).toEqual([1, 5])
  })

  it('最新値の保存に失敗したら failed（成功とは扱わない）', async () => {
    const { calls, save } = createControlledSave()
    const saver = createLatestWinsSaver({ save, onStatusChange: () => {} })
    saver.schedule(1)
    const flushing = saver.flush()
    await flush()
    calls[0]?.reject(new Error('DB error'))
    expect(await flushing).toBe('failed')
  })

  it('直前に失敗した値があれば、flushで再送する', async () => {
    const { calls, save } = createControlledSave()
    const saver = createLatestWinsSaver({ save, onStatusChange: () => {} })
    saver.schedule(7)
    await flush()
    calls[0]?.reject(new Error('一時的な失敗'))
    await flush()
    const flushing = saver.flush()
    await flush()
    expect(calls.map((call) => call.value)).toEqual([7, 7])
    calls[1]?.resolve()
    expect(await flushing).toBe('saved')
    expect(await saver.flush()).toBe('nothing')
  })
})
