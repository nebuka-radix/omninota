import { describe, expect, it } from 'vitest'
import { SCREENS, SCREEN_ORDER, screenOf } from '../../src/renderer/src/layouts/shell/screens'
import { noteListScrollTop } from '../../src/renderer/src/features/notes/note-list-scroll'

describe('uppercase English main menus', () => {
  it('uses the requested fixed menu labels without converting user data', () => {
    expect(SCREEN_ORDER.map((screen) => SCREENS[screen].label)).toEqual(['SUMMARY REVIEW', 'INBOX', 'PROJECT', 'NOTE', 'SETTINGS'])
    expect(screenOf('/notes')).toBe('notes')
    expect(screenOf('/projects')).toBe('projects')
  })
})
describe('reveal a newly created note in the main sidebar list', () => {
  it('leaves a fully visible row alone', () => expect(noteListScrollTop(40, 120, 10, 40)).toBe(40))
  it('scrolls down to a row below the viewport', () => expect(noteListScrollTop(40, 120, 180, 210)).toBe(130))
  it('scrolls up without moving ancestor containers', () => expect(noteListScrollTop(100, 120, -40, -10)).toBe(60))
  it('handles a collapsed list', () => expect(noteListScrollTop(100, 0, 0, 30)).toBe(100))
})
