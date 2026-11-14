import { describe, expect, it } from 'vitest'
import { createProjectService } from '../src/main/services/project-service'
import type { ProjectRepository } from '../src/main/repositories/project-repository'
import type { ProjectRow } from '../src/main/db/schema'
import type { ProjectDto } from '../src/shared/contracts/projects'
import { projectsSetFavoriteArgsSchema } from '../src/shared/validation/projects'
import { compareFavoriteProjects, sortProjects } from '../src/renderer/src/features/projects/project-order'

const ID = '12345678-1234-4234-8234-123456789abc'
function setup() {
  let row: ProjectRow | undefined = { id: ID, name: 'Project', favorite: false, done: false, doneOn: null,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
  const repository: ProjectRepository = {
    insert(value) { row = value },
    findById(id) { return row?.id === id ? row : undefined },
    listAll() { return row ? [row] : [] },
    updateName() { throw new Error('not used') },
    updateDone() { throw new Error('not used') },
    updateFavorite(id, favorite, updatedAt) {
      if (!row || row.id !== id) return undefined
      row = { ...row, favorite, updatedAt }
      return row
    },
    delete() { row = undefined; return 1 }
  }
  const service = createProjectService({ repository, countOpenTasks: () => 0, insertMilestone: () => {},
    countMilestones: () => 0, detachMilestones: () => 0, countTasks: () => ({ total: 0, hidden: 0 }),
    detachAndHideTasks: () => 0, transaction: (fn) => fn(), now: () => new Date('2026-01-02T00:00:00.000Z') })
  return { repository, service }
}

describe('project favorite', () => {
  it('updates favorite only, preserving project fields', () => {
    const { service } = setup()
    const initial = service.list()[0]!
    const saved = service.setFavorite({ id: ID, favorite: true })
    expect(saved).toEqual({ ...initial, favorite: true, updatedAt: '2026-01-02T00:00:00.000Z' })
    expect(service.setFavorite({ id: ID, favorite: false }).favorite).toBe(false)
  })
  it('does not change timestamps when already at the requested value', () => {
    const { service } = setup()
    const before = service.list()[0]!
    expect(service.setFavorite({ id: ID, favorite: false })).toEqual(before)
  })
  it('does not recreate deleted projects', () => {
    const { service, repository } = setup()
    repository.delete(ID)
    expect(() => service.setFavorite({ id: ID, favorite: true })).toThrow()
    expect(service.list()).toEqual([])
  })
  it('validates boolean and UUID at the IPC boundary', () => {
    expect(projectsSetFavoriteArgsSchema.safeParse([{ id: ID, favorite: true }]).success).toBe(true)
    expect(projectsSetFavoriteArgsSchema.safeParse([{ id: ID, favorite: 1 }]).success).toBe(false)
    expect(projectsSetFavoriteArgsSchema.safeParse([{ id: 'invalid', favorite: true }]).success).toBe(false)
  })
  it('groups favorites first in sidebar without changing common name order', () => {
    const { service } = setup()
    const a: ProjectDto = { ...service.list()[0]!, id: 'a', name: 'A', favorite: false }
    const b: ProjectDto = { ...a, id: 'b', name: 'B', favorite: true }
    expect([a, b].sort(compareFavoriteProjects).map((item) => item.id)).toEqual(['b', 'a'])
    expect(sortProjects([b, a]).map((item) => item.id)).toEqual(['a', 'b'])
  })
})
