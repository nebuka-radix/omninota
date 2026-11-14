import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createNoteRepository } from '../../src/main/repositories/note-repository'
import { createSettingsRepository } from '../../src/main/repositories/settings-repository'
import { createNoteService } from '../../src/main/services/note-service'
import { notesRenameArgsSchema, notesSaveArgsSchema } from '../../src/shared/validation/notes'
let db: AppDatabase | undefined
let directory: string | undefined
afterEach(() => { if (db) closeDatabase(db); if (directory) rmSync(directory, { recursive: true, force: true }); db = undefined; directory = undefined })
describe('independent note name and body saves', () => {
  it('does not overwrite the other field in either save order', () => {
    directory = mkdtempSync(join(tmpdir(), 'gtd-note-rename-'))
    db = openDatabase(join(directory, 'notes.sqlite'))
    runMigrations(db, resolve('migrations'))
    const service = createNoteService({ repository: createNoteRepository(db), settings: createSettingsRepository(db) })
    const original = service.create()
    service.save({ id: original.id, description: 'Body one' })
    const renamed = service.rename({ id: original.id, name: 'Renamed' })
    expect(renamed.description).toBe('Body one')
    const saved = service.save({ id: original.id, description: 'Body two' })
    expect(saved).toMatchObject({ name: 'Renamed', description: 'Body two' })
    service.rename({ id: original.id, name: 'Final name' })
    expect(service.list()[0]).toMatchObject({ name: 'Final name', description: 'Body two' })
  })
  it('validates inline names and allows body-only updates', () => {
    expect(notesRenameArgsSchema.parse([{ id: 1, name: ' Name ' }])[0].name).toBe('Name')
    expect(notesRenameArgsSchema.safeParse([{ id: 1, name: ' ' }]).success).toBe(false)
    expect(notesRenameArgsSchema.safeParse([{ id: 1, name: 'x'.repeat(97) }]).success).toBe(false)
    expect(notesRenameArgsSchema.safeParse([{ id: 1, name: 'x', description: 'must not write body' }]).success).toBe(false)
    expect(notesSaveArgsSchema.safeParse([{ id: 1, description: 'body only' }]).success).toBe(true)
  })
})
