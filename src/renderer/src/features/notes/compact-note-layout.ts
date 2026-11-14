import { NOTE_SIDEBAR } from '../../../../shared/contracts/notes'
export const COMPACT_NOTE_DIVIDER = 6
export function compactNoteLayout(totalWidth: number, preferredWidth: number) {
  const available = Math.max(0, Number.isFinite(totalWidth) ? totalWidth - COMPACT_NOTE_DIVIDER : 0)
  const editorMinimum = Math.min(80, available / 2)
  const maximum = Math.min(NOTE_SIDEBAR.max, Math.max(0, available - editorMinimum))
  const minimum = Math.min(NOTE_SIDEBAR.min, maximum)
  const preferred = Number.isFinite(preferredWidth) ? preferredWidth : NOTE_SIDEBAR.default
  const width = Math.max(minimum, Math.min(maximum, preferred))
  return { width, minimum, maximum, available }
}
export function clampCompactNoteWidth(width: number): number {
  return Math.round(Math.max(NOTE_SIDEBAR.min, Math.min(NOTE_SIDEBAR.max, Number.isFinite(width) ? width : NOTE_SIDEBAR.default)))
}
