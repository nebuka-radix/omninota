import { useCallback, useEffect, useMemo, useRef } from 'react'

// シングルクリックの保留（ダブルクリックと区別するため、少し待ってから実行する）。一覧ごとに1つ。
// 次の場合は保留中の操作を取り消す（実行しない）:
// - 同じ要素以外へのポインター操作・キー入力（他の操作を始めた）
// - cancel()（ダブルクリック・ドラッグの開始など）
// - アンマウント
export const DOUBLE_CLICK_WAIT_MS = 320

export function usePendingClick() {
  const pendingRef = useRef<{ timer: ReturnType<typeof setTimeout>; cleanup: () => void } | null>(null)

  const cancel = useCallback(() => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    clearTimeout(pending.timer)
    pending.cleanup()
  }, [])

  const schedule = useCallback(
    (element: Element, run: () => void, wait = DOUBLE_CLICK_WAIT_MS) => {
      cancel()
      const onPointerDown = (event: PointerEvent) => {
        // 同じ要素への2回目の押下（ダブルクリック）はクリックの処理で判断する
        if (event.target instanceof Node && element.contains(event.target)) return
        cancel()
      }
      const onKeyDown = () => cancel()
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('keydown', onKeyDown, true)
      const cleanup = () => {
        window.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('keydown', onKeyDown, true)
      }
      const timer = setTimeout(() => {
        pendingRef.current = null
        cleanup()
        run()
      }, wait)
      pendingRef.current = { timer, cleanup }
    },
    [cancel]
  )

  useEffect(() => cancel, [cancel])
  return useMemo(() => ({ schedule, cancel }), [schedule, cancel])
}
