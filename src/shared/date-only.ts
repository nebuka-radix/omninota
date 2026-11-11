// 日付のみの値（期限 dueto。フェーズ6）。時刻・タイムゾーンを持たない "YYYY-MM-DD" の文字列で扱う。
// 実行時依存・副作用なし（Main・Renderer・テストで共通に使う）。
// - 日付どうしの計算は、暦日の年・月・日だけで行う（UTCの暦で計算するが、日時へは変換しない。端末のタイムゾーンの影響を受けない）
// - 「今日」はローカルの暦日（端末のタイムゾーン）。日時（Date）から年・月・日をローカルで取り出す
// - "YYYY-MM-DD" は固定長なので、文字列の大小比較が日付の前後と一致する
export const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (value: number, length: number) => String(value).padStart(length, '0')

export function formatDateOnly(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`
}

// 実在する暦日か（2月30日・13月・うるう年でない2月29日などは false）。年は0001〜9999
export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  return day <= daysInMonth(year, month)
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28
  return [4, 6, 9, 11].includes(month) ? 30 : 31
}

// ローカルの暦日（端末のタイムゾーン）。UTCの日付ではない
export function localDateOnly(at: Date): string {
  return formatDateOnly(at.getFullYear(), at.getMonth() + 1, at.getDate())
}

// 暦日として days 日後（負なら前）。月末・年末・うるう年をまたいでも暦どおり。24時間のミリ秒の加算はしない
export function addDaysToDateOnly(value: string, days: number): string {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match || !isValidDateOnly(value)) throw new Error(`日付の形式が正しくありません: ${value}`)
  const date = new Date(0)
  // setUTCFullYear は 0〜99 年を 1900 年代に読み替えない
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days)
  return formatDateOnly(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

// Summary Review の期間（両端を含む日付）。This Week は暦週ではなく、明後日〜7日後
// 2つの暦日の差（to − from。日数）。どちらも "YYYY-MM-DD"。暦の日付どうしで数え、時刻・夏時間の影響を受けない
export function diffDateOnlyDays(from: string, to: string): number {
  return Math.round((dateOnlyEpochMs(to) - dateOnlyEpochMs(from)) / 86_400_000)
}

function dateOnlyEpochMs(value: string): number {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match || !isValidDateOnly(value)) throw new Error(`日付の形式が正しくありません: ${value}`)
  const date = new Date(0)
  date.setUTCFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getTime()
}

export type SummaryRanges = {
  today: string
  tomorrow: string
  weekStart: string
  weekEnd: string
}

export function summaryRanges(today: string): SummaryRanges {
  return {
    today,
    tomorrow: addDaysToDateOnly(today, 1),
    weekStart: addDaysToDateOnly(today, 2),
    weekEnd: addDaysToDateOnly(today, 7)
  }
}

// 次のローカルの0時までのミリ秒（日付の切り替えの検知に使う。暦日の翌日の0時をローカルで求める）
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return Math.max(0, next.getTime() - now.getTime())
}
