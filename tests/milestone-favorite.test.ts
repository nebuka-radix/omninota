import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, closeDatabase, type AppDatabase } from '../src/main/db/client'
import { runMigrations } from '../src/main/db/migrate'
import { createTransactionRunner } from '../src/main/db/transaction'
import { createMilestoneRepository, type MilestoneRepository } from '../src/main/repositories/milestone-repository'
import { createProjectRepository } from '../src/main/repositories/project-repository'
import { createMilestoneService, type MilestoneService } from '../src/main/services/milestone-service'
import { milestonesSetFavoriteArgsSchema } from '../src/shared/validation/milestones'

const PROJECT_ID = '12345678-1234-4234-8234-123456789abc'
let dir: string
let db: AppDatabase
let repository: MilestoneRepository
let service: MilestoneService
let clock: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'gtd-milestone-favorite-'))
  db = openDatabase(join(dir, 'test.sqlite'))
  runMigrations(db, join(process.cwd(), 'migrations'))
  const projects = createProjectRepository(db)
  projects.insert({ id: PROJECT_ID, name: 'P', favorite: false, done: false, doneOn: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' })
  repository = createMilestoneRepository(db)
  clock = '2026-01-01T00:00:00.000Z'
  service = createMilestoneService({ repository, findProject: projects.findById, countTasks: () => 0,
    hideTasks: () => 0, transaction: createTransactionRunner(db), now: () => new Date(clock) })
})
afterEach(() => {
  vi.restoreAllMocks()
  if (db) closeDatabase(db)
  if (dir) rmSync(dir, { recursive: true, force: true })
})
describe('milestone favorite', () => {
  it('creates with false and changes favorite without changing other fields', () => {
    const created = service.create({ projectId: PROJECT_ID, name: 'M' })
    expect(created.favorite).toBe(false)
    clock = '2026-01-02T00:00:00.000Z'
    expect(service.setFavorite({ id: created.id, favorite: true })).toEqual({ ...created, favorite: true, updatedAt: clock })
    expect(service.setFavorite({ id: created.id, favorite: false }).favorite).toBe(false)
  })
  it('does not update timestamps for identical state', () => {
    const created = service.create({ projectId: PROJECT_ID, name: 'M' })
    clock = '2026-01-02T00:00:00.000Z'
    expect(service.setFavorite({ id: created.id, favorite: false })).toEqual(created)
  })
  it('rejects hidden and deleted milestones', () => {
    const created = service.create({ projectId: PROJECT_ID, name: 'M' })
    repository.detachByProject(PROJECT_ID, clock)
    expect(() => service.setFavorite({ id: created.id, favorite: true })).toThrow()
    db.$client.prepare('DELETE FROM milestones WHERE id = ?').run(created.id)
    expect(() => service.setFavorite({ id: created.id, favorite: true })).toThrow()
    expect(service.list()).toEqual([])
  })
  it('does not modify the row on write failure', () => {
    const created = service.create({ projectId: PROJECT_ID, name: 'M' })
    vi.spyOn(repository, 'updateFavorite').mockImplementation(() => { throw new Error('write failure') })
    expect(() => service.setFavorite({ id: created.id, favorite: true })).toThrow('write failure')
    expect(service.list()).toEqual([created])
  })
  it('validates UUID and boolean at IPC boundary', () => {
    expect(milestonesSetFavoriteArgsSchema.safeParse([{ id: PROJECT_ID, favorite: true }]).success).toBe(true)
    expect(milestonesSetFavoriteArgsSchema.safeParse([{ id: PROJECT_ID, favorite: 1 }]).success).toBe(false)
    expect(milestonesSetFavoriteArgsSchema.safeParse([{ id: 'invalid', favorite: false }]).success).toBe(false)
  })
  it('has SQL default 0 when the column is omitted', () => {
    db.$client.prepare('INSERT INTO milestones (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run('raw-milestone', PROJECT_ID, 'Raw', clock, clock)
    expect(repository.findById('raw-milestone')?.favorite).toBe(false)
  })
})
