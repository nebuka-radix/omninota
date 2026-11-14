export function noteListScrollTop(scrollTop: number, viewportHeight: number, rowTop: number, rowBottom: number): number {
  if (viewportHeight <= 0) return scrollTop
  if (rowTop < 0 || rowBottom - rowTop > viewportHeight) return Math.max(0, scrollTop + rowTop)
  if (rowBottom > viewportHeight) return Math.max(0, scrollTop + rowBottom - viewportHeight)
  return scrollTop
}
