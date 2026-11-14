import { describe, expect, it } from 'vitest'
import { notesSaveArgsSchema, notesFavoriteArgsSchema, notesSaveSidebarWidthArgsSchema } from '../../src/shared/validation/notes'
import { isWorkspaceRoute } from '../../src/shared/contracts/workspace'
import { resolveStartupTarget } from '../../src/renderer/src/features/projects/project-route'

describe('Note input and route validation', () => {
  it('allows 96-character names, trims outer whitespace, and preserves the body', () => {
    const input = notesSaveArgsSchema.parse([{ id: 1, name: '  Note  ', description: '  text\n' }])[0]
    expect(input).toMatchObject({ name: 'Note', description: '  text\n' })
    expect(notesSaveArgsSchema.safeParse([{ id: 1, name: 'x'.repeat(96), description: '' }]).success).toBe(true)
    expect(notesSaveArgsSchema.safeParse([{ id: 1, name: 'x'.repeat(97), description: '' }]).success).toBe(false)
    expect(notesSaveArgsSchema.safeParse([{ id: 1, name: ' ', description: '' }]).success).toBe(false)
  })
  it('rejects invalid IDs, arbitrary fields, and invalid widths', () => {
    expect(notesFavoriteArgsSchema.safeParse([{ id: 0, favorite: true }]).success).toBe(false)
    expect(notesFavoriteArgsSchema.safeParse([{ id: 1, favorite: true, active: false }]).success).toBe(false)
    expect(notesSaveSidebarWidthArgsSchema.safeParse([139]).success).toBe(false)
    expect(notesSaveSidebarWidthArgsSchema.safeParse([481]).success).toBe(false)
    expect(notesSaveSidebarWidthArgsSchema.safeParse([220]).success).toBe(true)
  })
  it('restores the Note route', async () => {
    expect(isWorkspaceRoute('/notes')).toBe(true)
    expect(await resolveStartupTarget('/notes', async () => [])).toEqual({ to: '/notes' })
  })
})
