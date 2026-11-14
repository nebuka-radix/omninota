import { describe, expect, it } from 'vitest'
import { outlinePaneLayout } from '../../src/renderer/src/components/monaco-editor/outline-layout'

describe('Monaco outline pane width', () => {
  it('enforces the 128px minimum', () => {
    expect(outlinePaneLayout(600, 30).width).toBe(128)
    expect(outlinePaneLayout(100, null).width).toBe(128)
    expect(outlinePaneLayout(0, null).width).toBe(128)
  })
  it('retains automatic initial sizing, bounded by the minimum', () => {
    expect(outlinePaneLayout(600, null).width).toBe(168)
    expect(outlinePaneLayout(1000, null).width).toBe(220)
    expect(outlinePaneLayout(300, null).width).toBe(128)
  })
  it('allows a dragged width greater than the former 220px cap', () => {
    expect(outlinePaneLayout(700, 360).width).toBe(360)
  })
  it('reserves space for the divider and workspace on a sufficient viewport', () => {
    expect(outlinePaneLayout(400, 900)).toEqual({ width: 314, minimum: 128, maximum: 314 })
  })
  it('preserves a preferred width when a smaller viewport temporarily clamps it', () => {
    const preferred = 360
    expect(outlinePaneLayout(400, preferred).width).toBe(314)
    expect(outlinePaneLayout(700, preferred).width).toBe(360)
    expect(preferred).toBe(360)
  })
  it('falls back to automatic sizing for an invalid preference', () => {
    expect(outlinePaneLayout(600, Number.NaN).width).toBe(168)
  })
})
