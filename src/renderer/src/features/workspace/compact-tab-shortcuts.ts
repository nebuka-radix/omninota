export type CompactTabKeyEvent = {
  key: string
  ctrlKey: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  keyCode?: number
}

export function compactTabDirection(event: CompactTabKeyEvent): -1 | 0 | 1 {
  if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.isComposing || event.keyCode === 229) return 0
  return event.key === 'PageDown' ? 1 : event.key === 'PageUp' ? -1 : 0
}

export function adjacentCompactTab<T>(tabs: readonly T[], current: T, direction: -1 | 1): T | undefined {
  const index = tabs.indexOf(current)
  if (!tabs.length || index < 0) return undefined
  return tabs[(index + direction + tabs.length) % tabs.length]
}
