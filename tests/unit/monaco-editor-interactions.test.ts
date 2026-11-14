import { describe, expect, it, vi } from 'vitest'
import { enableNativeKeyRepeat } from '../../src/main/infrastructure/key-repeat'
import { previewFraction, previewLayout } from '../../src/renderer/src/components/monaco-editor/preview-layout'

describe('native key repeat', () => {
  it('disables accent press-and-hold for the macOS app', () => {
    const setUserDefault = vi.fn()
    enableNativeKeyRepeat('darwin', { setUserDefault })
    expect(setUserDefault).toHaveBeenCalledExactlyOnceWith('ApplePressAndHoldEnabled', 'boolean', false)
  })
  it('does not change preferences on other platforms', () => {
    const setUserDefault = vi.fn()
    enableNativeKeyRepeat('win32', { setUserDefault })
    enableNativeKeyRepeat('linux', { setUserDefault })
    expect(setUserDefault).not.toHaveBeenCalled()
  })
})

describe('Monaco preview divider', () => {
  it('starts with equal panes', () => {
    expect(previewLayout(806, 0.5).width).toBe(400)
  })
  it('keeps minimum widths on a wide screen', () => {
    expect(previewLayout(806, -10).width).toBe(160)
    expect(previewLayout(806, 10).width).toBe(680)
  })
  it('does not overflow a narrow container', () => {
    const result = previewLayout(206, 0.8)
    expect(result.width).toBe(100)
    expect(result.width).toBeLessThanOrEqual(result.available)
    expect(previewLayout(0, 0.5).width).toBe(0)
  })
  it('converts pointer movement into a clamped fraction', () => {
    expect(previewFraction(806, 500)).toBe(0.625)
    expect(previewLayout(806, previewFraction(806, 500)).width).toBe(500)
    expect(previewFraction(0, 500)).toBe(0.5)
  })
})
