import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { z } from 'zod'
import type { SettingsRepository } from '../repositories/settings-repository'

const boundsSchema = z.object({
  x: z.number().int().min(-100000).max(100000),
  y: z.number().int().min(-100000).max(100000),
  width: z.number().int().min(240).max(30000),
  height: z.number().int().min(480).max(30000)
})
const stateSchema = z.object({ version: z.literal(1), compact: z.boolean(), bounds: boundsSchema })
type State = z.infer<typeof stateSchema>

export function createWindowState(repository: SettingsRepository, normalMinimum: number) {
  let state: State | null = null
  try {
    const row = repository.get('windowState')
    if (row) {
      const parsed = stateSchema.safeParse(JSON.parse(row.value))
      if (parsed.success) state = parsed.data
      else console.warn('[window-state] 保存値が不正なため既定値を使用します')
    }
  } catch (error) { console.error('[window-state] 読み込みに失敗しました', error) }
  let compact = state?.compact ?? false
  let win: BrowserWindow | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const restoreBounds = (): Rectangle | undefined => {
    if (!state) return undefined
    const saved = state.bounds
    const area = screen.getDisplayMatching(saved).workArea
    const width = Math.max(compact ? 240 : normalMinimum, Math.min(saved.width, area.width))
    const height = Math.max(480, Math.min(saved.height, area.height))
    return {
      width, height,
      x: Math.round(Math.max(area.x, Math.min(saved.x, area.x + area.width - width))),
      y: Math.round(Math.max(area.y, Math.min(saved.y, area.y + area.height - height)))
    }
  }
  const save = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!win || win.isDestroyed()) return
    const bounds = win.isMaximized() || win.isFullScreen() || win.isMinimized() ? win.getNormalBounds() : win.getBounds()
    const next: State = { version: 1, compact, bounds }
    repository.upsert({ key: 'windowState', value: JSON.stringify(next), updatedAt: new Date().toISOString() })
    state = next
  }
  const safeSave = () => {
    try { save() } catch (error) { console.error('[window-state] 保存に失敗しました', error) }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(safeSave, 150)
  }
  return {
    get compact() { return compact },
    restoreBounds,
    attach(window: BrowserWindow) {
      win = window
      window.on('move', schedule)
      window.on('resize', schedule)
      window.on('close', safeSave)
      window.once('closed', () => {
        if (timer) clearTimeout(timer)
        timer = null
        win = null
      })
    },
    setCompact(next: boolean) {
      if (!win || win.isDestroyed()) throw new Error('ウィンドウがありません')
      const previous = compact
      const bounds = win.getBounds()
      try {
        compact = next
        win.setMinimumSize(next ? 240 : normalMinimum, 480)
        if (!next && bounds.width < normalMinimum) win.setSize(normalMinimum, bounds.height)
        save()
      } catch (error) {
        compact = previous
        win.setMinimumSize(previous ? 240 : normalMinimum, 480)
        win.setBounds(bounds)
        throw error
      }
    }
  }
}
