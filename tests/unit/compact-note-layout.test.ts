import { describe, expect, it } from 'vitest'
import { clampCompactNoteWidth, compactNoteLayout } from '../../src/renderer/src/features/notes/compact-note-layout'
import { notesSaveSidebarWidthArgsSchema } from '../../src/shared/validation/notes'

describe('compact NOTE sidebar layout', () => {
  it('uses the saved preference at a sufficient width', () => {
    expect(compactNoteLayout(640, 220).width).toBe(220)
    expect(compactNoteLayout(640, 310).width).toBe(310)
  })
  it('fits both panes within a 240px compact screen', () => {
    const result = compactNoteLayout(240, 220)
    expect(result.width).toBe(154)
    expect(result.available - result.width).toBe(80)
    expect(compactNoteLayout(240, 104).width).toBe(104)
  })
  it('shrinks only the visible width without changing the saved preference', () => {
    const saved = 310
    expect(compactNoteLayout(240, saved).width).toBe(154)
    expect(compactNoteLayout(640, saved).width).toBe(310)
    expect(saved).toBe(310)
  })
  it('clamps preferences to the supported storage bounds', () => {
    expect(clampCompactNoteWidth(20)).toBe(104)
    expect(clampCompactNoteWidth(900)).toBe(480)
    expect(clampCompactNoteWidth(Number.NaN)).toBe(220)
    expect(notesSaveSidebarWidthArgsSchema.safeParse([104]).success).toBe(true)
    expect(notesSaveSidebarWidthArgsSchema.safeParse([103]).success).toBe(false)
  })
  it('handles a container not measured yet', () => expect(compactNoteLayout(0, 220).width).toBe(0))
})
