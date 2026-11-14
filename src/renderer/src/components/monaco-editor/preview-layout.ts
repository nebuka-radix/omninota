export const PREVIEW_DIVIDER_WIDTH = 6

export function previewLayout(totalWidth: number, fraction: number) {
  const available = Math.max(0, Number.isFinite(totalWidth) ? totalWidth - PREVIEW_DIVIDER_WIDTH : 0)
  const minimum = Math.min(160, available / 2)
  const maximum = available - Math.min(120, available / 2)
  const ratio = Number.isFinite(fraction) ? fraction : 0.5
  const width = Math.max(minimum, Math.min(maximum, available * ratio))
  return { available, minimum, maximum, width }
}

export function previewFraction(totalWidth: number, desiredWidth: number): number {
  const layout = previewLayout(totalWidth, 0.5)
  if (layout.available === 0) return 0.5
  return Math.max(layout.minimum, Math.min(layout.maximum, desiredWidth)) / layout.available
}
