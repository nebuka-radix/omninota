import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isValidDateOnly, localDateOnly, msUntilNextLocalMidnight } from '../../../shared/date-only'

// ローカルの「今日」（"YYYY-MM-DD"）をアプリ全体で1つだけ持つ（TaskRow の期限表示・Summary Review が使う）。
// 日付は Main に問い合わせる（保存の「今日」「明日」・Summary の判定と同じ日付にする）。応答までの間・失敗時は画面の時計の日付を使う。
// 行ごとにタイマーを作らない。確かめる契機: 次の0時の少し後・ウィンドウの再フォーカス・表示の再開（スリープ復帰を含む）・一定間隔。
// 確かめるたびに Summary Review の取得結果を古いものとして扱う（判定の日付は Main が決めるため、Main 側の日付の変化も拾う。
// 表示していなければ取り直さず、次に開いた時に取り直す）。タイマー・購読はアンマウント時に解除する。
const DAY_CHECK_INTERVAL_MS = 60_000

const LocalDayContext = createContext<string | null>(null)

export function LocalDayProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [day, setDay] = useState(() => localDateOnly(new Date()))
  const dayRef = useRef(day)
  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout> | null = null
    let disposed = false
    const apply = (next: string) => {
      if (disposed || next === dayRef.current) return
      dayRef.current = next
      setDay(next)
    }
    // Main の日付（失敗時は画面の時計の日付）
    const fetchToday = () =>
      window.gtd.summary.today().then(
        (result) => (result.ok && isValidDateOnly(result.data) ? result.data : localDateOnly(new Date())),
        () => localDateOnly(new Date())
      )
    const check = () => {
      void fetchToday().then(apply)
      void queryClient.invalidateQueries({ queryKey: ['summary'] })
    }
    const scheduleMidnight = () => {
      if (midnightTimer !== null) clearTimeout(midnightTimer)
      midnightTimer = setTimeout(() => {
        check()
        scheduleMidnight()
      }, msUntilNextLocalMidnight(new Date()) + 500)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }
    scheduleMidnight()
    // スリープ復帰などで0時のタイマーが遅れても、この間隔で日付の変化を拾う（日付が変わった時だけ更新する）
    const interval = setInterval(() => {
      void fetchToday().then((next) => {
        if (next === dayRef.current) return
        apply(next)
        void queryClient.invalidateQueries({ queryKey: ['summary'] })
        scheduleMidnight()
      })
    }, DAY_CHECK_INTERVAL_MS)
    // 起動時に Main の日付へ合わせる
    void fetchToday().then(apply)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      if (midnightTimer !== null) clearTimeout(midnightTimer)
      clearInterval(interval)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [queryClient])
  return <LocalDayContext.Provider value={day}>{children}</LocalDayContext.Provider>
}

export function useLocalDay(): string {
  const day = useContext(LocalDayContext)
  if (day === null) throw new Error('useLocalDay は LocalDayProvider の中で使ってください')
  return day
}
