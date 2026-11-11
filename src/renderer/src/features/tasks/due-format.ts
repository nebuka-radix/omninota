import { DATE_ONLY_PATTERN, diffDateOnlyDays } from '../../../../shared/date-only'

// 期限（"YYYY-MM-DD"）の表示（フェーズ6）。日時へ変換せず、年・月・日の文字列から作る（タイムゾーンで前後にずれない）。
// 曜日は暦日から求める（UTCの暦で計算するが、日付そのものは変えない）
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function parts(value: string) {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) }
}

function weekday(year: number, month: number, day: number): string {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  return WEEKDAYS[date.getUTCDay()] ?? ''
}

// 一覧の行の短い表示（今年なら「11/12(木)」、それ以外は「2027/01/02(土)」）
export function formatDueShort(value: string, currentYear: number): string {
  const p = parts(value)
  if (!p) return value
  const w = weekday(p.year, p.month, p.day)
  const md = `${p.month}/${p.day}`
  return p.year === currentYear ? `${md}(${w})` : `${p.year}/${md}(${w})`
}

// 読み上げ用（「期限 2026年11月12日（木）」）
export function formatDueLong(value: string): string {
  const p = parts(value)
  if (!p) return `期限 ${value}`
  return `期限 ${p.year}年${p.month}月${p.day}日（${weekday(p.year, p.month, p.day)}）`
}

// TaskRow の期限の表示（ローカルの暦日の差で決める。日時へ変換しない）。
// - 今日: Today / 明日: Tomorrow / 明後日以降: {N}Days（例: 2Days）
// - 昨日以前: 日付そのもの（期限超過。見た目と読み上げで示す）
// - 未設定: null（呼び出し側は期限設定のアイコンを表示する）
export type DueLabel = {
  kind: 'today' | 'tomorrow' | 'days' | 'overdue'
  text: string
  // 読み上げ・ツールチップ用（「期限 今日（2026年11月12日（木））」など）
  description: string
}

export function dueLabelOf(dueto: string | null, today: string): DueLabel | null {
  if (dueto === null || !DATE_ONLY_PATTERN.test(dueto)) return null
  const days = diffDateOnlyDays(today, dueto)
  const date = formatDueLong(dueto).replace('期限 ', '')
  if (days < 0) return { kind: 'overdue', text: formatDueShort(dueto, Number(today.slice(0, 4))), description: `期限超過 ${date}（${-days}日前）` }
  if (days === 0) return { kind: 'today', text: 'Today', description: `期限 今日（${date}）` }
  if (days === 1) return { kind: 'tomorrow', text: 'Tomorrow', description: `期限 明日（${date}）` }
  return { kind: 'days', text: `${days}Days`, description: `期限 ${days}日後（${date}）` }
}
