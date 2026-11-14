export const OUTLINE_MIN_WIDTH = 128
export const OUTLINE_DIVIDER_WIDTH = 6
export const OUTLINE_WORKSPACE_MIN_WIDTH = 80

export function outlinePaneLayout(viewportWidth: number, preferredWidth: number | null) {
  const viewport = Math.max(0, Number.isFinite(viewportWidth) ? viewportWidth : 0)
  const maximum = Math.max(OUTLINE_MIN_WIDTH, viewport - OUTLINE_DIVIDER_WIDTH - OUTLINE_WORKSPACE_MIN_WIDTH)
  const automatic = Math.max(OUTLINE_MIN_WIDTH, Math.min(220, viewport * 0.28))
  const preferred = preferredWidth !== null && Number.isFinite(preferredWidth) ? preferredWidth : automatic
  const width = Math.round(Math.max(OUTLINE_MIN_WIDTH, Math.min(maximum, preferred)))
  return { width, minimum: OUTLINE_MIN_WIDTH, maximum }
}
