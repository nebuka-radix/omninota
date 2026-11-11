// 開発起動（npm run dev → electron-vite → Electron）で、親プロセス（electron-vite）が先に終了した場合に
// Electron が取り残されないようにする（フェーズ5.9）。electronをimportしないので、ホストNode.jsのテストから検証できる。
// - 親が終了すると、このプロセスの親は別のプロセス（launchd など）に付け替えられ、process.ppid が変わる。
//   一定間隔で確認し、変わったら1回だけ onOrphaned を呼ぶ（呼び出し側は app.quit() で通常の終了フローへ進める）。
// - 強制終了はしない（保存確認を飛ばさない）。終了がキャンセルされても、繰り返し要求しない。
// - stop() で監視を止める（終了時に呼ぶ）。タイマーはプロセスの終了を妨げない（unref）。
export const PARENT_WATCH_INTERVAL_MS = 1000

export type ParentWatcher = { stop(): void }

export function watchParentProcess(deps: {
  getParentPid: () => number
  onOrphaned: (info: { initialParentPid: number; currentParentPid: number }) => void
  intervalMs?: number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}): ParentWatcher {
  const setTimer =
    deps.setTimer ??
    ((callback, ms) => {
      const timer = setInterval(callback, ms)
      timer.unref()
      return timer
    })
  const clearTimer = deps.clearTimer ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>))
  const initialParentPid = deps.getParentPid()
  let timer: unknown = null
  const stop = () => {
    if (timer === null) return
    clearTimer(timer)
    timer = null
  }
  timer = setTimer(() => {
    // 停止後に届いた呼び出し（タイマーの取り消しと行き違ったもの）は無視する
    if (timer === null) return
    const currentParentPid = deps.getParentPid()
    if (currentParentPid === initialParentPid) return
    stop()
    deps.onOrphaned({ initialParentPid, currentParentPid })
  }, deps.intervalMs ?? PARENT_WATCH_INTERVAL_MS)
  return { stop }
}
