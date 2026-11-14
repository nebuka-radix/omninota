import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase, closeDatabase, type AppDatabase } from '../../src/main/db/client'
import { runMigrations } from '../../src/main/db/migrate'
import { createTransactionRunner } from '../../src/main/db/transaction'
import { createTaskImportantRepository } from '../../src/main/repositories/task-important-repository'
import { createTaskImportantService } from '../../src/main/services/task-important-service'
let directory: string | undefined
let db: AppDatabase | undefined
const migrations = resolve('migrations')
afterEach(() => { if (db) closeDatabase(db); if (directory) rmSync(directory, { recursive: true, force: true }); db = undefined; directory = undefined })
const initialize = () => {
  directory = mkdtempSync(join(tmpdir(), 'gtd-important-'))
  db = openDatabase(join(directory, 'gtd.sqlite'))
  return db
}
const id = '00000000-0000-4000-8000-000000000001'
describe('task important database migration and persistence', () => {
  it('adds false to old rows without changing old column values', () => {
    const database = initialize()
    const legacy = join(directory!, 'legacy')
    mkdirSync(join(legacy, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync(join(migrations, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.slice(0, -1)
    for (const entry of journal.entries) copyFileSync(join(migrations, `${entry.tag}.sql`), join(legacy, `${entry.tag}.sql`))
    writeFileSync(join(legacy, 'meta/_journal.json'), JSON.stringify(journal))
    runMigrations(database, legacy)
    database.$client.prepare('INSERT INTO tasks (id, title, created_at, updated_at, favorite) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'Keep title', '2026-01-01', '2026-01-02', 1)
    const before = database.$client.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>
    runMigrations(database, migrations)
    const after = database.$client.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown>
    expect(after).toEqual({ ...before, important: 0 })
    expect((database.$client.prepare('PRAGMA table_info(tasks)').all() as { name: string; notnull: number }[])
      .find((column) => column.name === 'important')?.notnull).toBe(1)
  })
  it('persists the target state, is idempotent, preserves other fields, and rejects hidden rows', () => {
    const database = initialize()
    runMigrations(database, migrations)
    database.$client.prepare('INSERT INTO tasks (id, title, created_at, updated_at, favorite) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'Keep title', '2026-01-01', '2026-01-02', 1)
    let at = new Date('2026-01-03T00:00:00.000Z')
    const service = createTaskImportantService({ repository: createTaskImportantRepository(database), transaction: createTransactionRunner(database), now: () => at })
    const first = service.set({ id, important: true })
    expect(first).toMatchObject({ important: true, favorite: true, title: 'Keep title', doneOn: null, dueto: null })
    at = new Date('2026-01-04T00:00:00.000Z')
    expect(service.set({ id, important: true }).updatedAt).toBe(first.updatedAt)
    expect(service.set({ id, important: false })).toMatchObject({ important: false, favorite: true, title: 'Keep title' })
    closeDatabase(database)
    db = openDatabase(join(directory!, 'gtd.sqlite'))
    expect(createTaskImportantRepository(db).find(id)?.important).toBe(false)
    db.$client.prepare('UPDATE tasks SET hidden_at = ? WHERE id = ?').run('2026-01-05', id)
    const hidden = createTaskImportantService({ repository: createTaskImportantRepository(db), transaction: createTransactionRunner(db) })
    expect(() => hidden.set({ id, important: true })).toThrow('見つかりません')
  })
})
