import { describe, expect, it } from 'vitest'
import { adjacentCompactTab, compactTabDirection } from '../../src/renderer/src/features/workspace/compact-tab-shortcuts'

describe('compact tab shortcuts', () => {
  it('recognizes Ctrl+PageDown and Ctrl+PageUp', () => {
    expect(compactTabDirection({ key: 'PageDown', ctrlKey: true })).toBe(1)
    expect(compactTabDirection({ key: 'PageUp', ctrlKey: true })).toBe(-1)
  })
  it('does not claim plain page scrolling or other shortcuts', () => {
    expect(compactTabDirection({ key: 'PageDown', ctrlKey: false })).toBe(0)
    expect(compactTabDirection({ key: 'PageUp', ctrlKey: false, metaKey: true })).toBe(0)
    expect(compactTabDirection({ key: 'PageDown', ctrlKey: true, shiftKey: true })).toBe(0)
    expect(compactTabDirection({ key: 'PageDown', ctrlKey: true, altKey: true })).toBe(0)
    expect(compactTabDirection({ key: 'PageDown', ctrlKey: true, metaKey: true })).toBe(0)
    expect(compactTabDirection({ key: 'ArrowDown', ctrlKey: true })).toBe(0)
  })
  it('does not handle IME composition', () => {
    expect(compactTabDirection({ key: 'PageDown', ctrlKey: true, isComposing: true })).toBe(0)
    expect(compactTabDirection({ key: 'PageDown', ctrlKey: true, keyCode: 229 })).toBe(0)
  })
  it('cycles through all four tabs in display order', () => {
    const tabs = ['day', 'inbox', 'project', 'note'] as const
    expect(adjacentCompactTab(tabs, 'day', 1)).toBe('inbox')
    expect(adjacentCompactTab(tabs, 'inbox', 1)).toBe('project')
    expect(adjacentCompactTab(tabs, 'project', 1)).toBe('note')
    expect(adjacentCompactTab(tabs, 'note', 1)).toBe('day')
    expect(adjacentCompactTab(tabs, 'day', -1)).toBe('note')
    expect(adjacentCompactTab(tabs, 'note', -1)).toBe('project')
  })
  it('handles empty or unrecognized state safely', () => {
    expect(adjacentCompactTab<string>([], 'day', 1)).toBeUndefined()
    expect(adjacentCompactTab(['day'], 'missing', 1)).toBeUndefined()
    expect(adjacentCompactTab(['day'], 'day', -1)).toBe('day')
  })
})
