import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { closeDatabase, openDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createNoteRepository } from '../../src/main/repositories/note-repository'
import { createSettingsRepository } from '../../src/main/repositories/settings-repository'
import { createNoteService } from '../../src/main/services/note-service'

let directory: string
let db: AppDatabase | undefined
const migrations = resolve('migrations')
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'gtd-notes-test-')) })
afterEach(() => { if (db) closeDatabase(db); db = undefined; rmSync(directory, { recursive: true, force: true }) })
const open = () => { db = openDatabase(join(directory, 'notes.sqlite')); runMigrations(db, migrations); return db }
const service = (database: AppDatabase) => createNoteService({ repository: createNoteRepository(database), settings: createSettingsRepository(database), now: () => new Date('2026-01-01T00:00:00.000Z') })

describe('notes persistence', () => {
  it('creates autoincrement notes with requested defaults and saves Markdown', () => {
    const database = open()
    const notes = service(database)
    const first = notes.create()
    const second = notes.create()
    expect(first).toMatchObject({ favorite: false, active: true, name: 'New Note', description: '' })
    expect(second.id).toBeGreaterThan(first.id)
    const body = '# title\n\n```mermaid\nflowchart LR\nA --> B\n```\n'
    notes.save({ id: first.id, name: 'My note', description: body })
    closeDatabase(database)
    db = openDatabase(join(directory, 'notes.sqlite'))
    expect(service(db).list().find((note) => note.id === first.id)).toMatchObject({ name: 'My note', description: body })
  })
  it('orders favorite first and updated_on descending; inactive notes are hidden', () => {
    const database = open()
    const notes = service(database)
    const first = notes.create()
    const second = notes.create()
    notes.setFavorite({ id: first.id, favorite: true })
    notes.save({ id: second.id, name: 'Updated', description: 'text' })
    expect(notes.list().map((note) => note.id)).toEqual([first.id, second.id])
    notes.setFavorite({ id: first.id, favorite: false })
    expect(notes.list()[0]?.id).toBe(first.id)
    database.$client.prepare('UPDATE note SET active = 0 WHERE id = ?').run(first.id)
    expect(notes.list().map((note) => note.id)).toEqual([second.id])
    expect(() => notes.save({ id: first.id, name: 'inactive', description: '' })).toThrow('見つかりません')
  })
  it('persists note sidebar width independently of existing workspace settings', () => {
    const database = open()
    const notes = service(database)
    expect(notes.getSidebarWidth()).toBe(220)
    notes.saveSidebarWidth(310)
    closeDatabase(database)
    db = openDatabase(join(directory, 'notes.sqlite'))
    expect(service(db).getSidebarWidth()).toBe(310)
    expect(createSettingsRepository(db).get('workspace')).toBeUndefined()
  })
  it('upgrades a legacy database without modifying existing task data', () => {
    const legacy = join(directory, 'legacy-migrations')
    mkdirSync(join(legacy, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync(join(migrations, 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    // 049-note-migration-boundary: start immediately before note was introduced.
    const noteMigrationIndex = journal.entries.findIndex((entry) =>
      /CREATE\s+TABLE\s+[`"]?note[`"]?\s*\(/i.test(readFileSync(join(migrations, `${entry.tag}.sql`), 'utf8')))
    expect(noteMigrationIndex).toBeGreaterThanOrEqual(0)
    journal.entries = journal.entries.slice(0, noteMigrationIndex)
    for (const entry of journal.entries) copyFileSync(join(migrations, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`))
    writeFileSync(join(legacy, 'meta', '_journal.json'), JSON.stringify(journal))
    db = openDatabase(join(directory, 'legacy.sqlite'))
    runMigrations(db, legacy)
    db.$client.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run('legacy-task', 'Keep this', '2026-01-01', '2026-01-01')
    const before = db.$client.prepare('SELECT * FROM tasks').all() as Record<string, unknown>[]
    runMigrations(db, migrations)
    expect(db.$client.prepare('SELECT * FROM tasks').all()).toEqual((/* 049-important-default */ (before)).map((row) => ({ ...row, important: 0 })))
    const columns = db.$client.prepare('PRAGMA table_info(note)').all() as { name: string; type: string }[]
    expect(columns.map((column) => column.name)).toEqual(['id', 'favorite', 'name', 'description', 'active', 'created_on', 'updated_on'])
    expect(columns.find((column) => column.name === 'name')?.type.toLowerCase()).toBe('varchar(96)')
    expect(columns.find((column) => column.name === 'created_on')?.type.toLowerCase()).toBe('datetime')
  })
})
