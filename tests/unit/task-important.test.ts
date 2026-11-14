import { describe, expect, it } from 'vitest'
import type { TaskDto } from '../../src/shared/contracts/tasks'
import { tasksSetImportantArgsSchema } from '../../src/shared/validation/tasks'
import { importantTasks, importantTitleStyle, IMPORTANT_ON } from '../../src/renderer/src/features/tasks/important-presentation'
const task = (id: string, changes: Partial<TaskDto> = {}): TaskDto => ({
  id, title: id, createdAt: '2026-01-01', updatedAt: '2026-01-01', doneOn: null,
  projectId: null, milestoneId: null, position: null, dueto: null, favorite: false, important: false, ...changes
})
describe('Important', () => {
  it('includes incomplete important tasks with or without a due date', () => {
    const tasks = [task('none', { important: true }), task('due', { important: true, dueto: '2026-01-01' }),
      task('done', { important: true, doneOn: '2026-01-02' }), task('normal')]
    expect(importantTasks(tasks).map((item) => item.id)).toEqual(['none', 'due'])
  })
  it('uses red bold underlined titles, retaining completion strike-through', () => {
    expect(importantTitleStyle(true, false)).toMatchObject({ color: IMPORTANT_ON, fontWeight: 800, textDecoration: 'underline' })
    expect(importantTitleStyle(true, true).textDecoration).toBe('line-through underline')
    expect(importantTitleStyle(false, false)).toMatchObject({ fontWeight: 400, textDecoration: 'none' })
  })
  it('accepts only explicit boolean targets for valid task IDs', () => {
    const id = '00000000-0000-4000-8000-000000000001'
    expect(tasksSetImportantArgsSchema.safeParse([{ id, important: true }]).success).toBe(true)
    expect(tasksSetImportantArgsSchema.safeParse([{ id, important: false }]).success).toBe(true)
    expect(tasksSetImportantArgsSchema.safeParse([{ id, important: 1 }]).success).toBe(false)
    expect(tasksSetImportantArgsSchema.safeParse([{ id, important: 'true' }]).success).toBe(false)
    expect(tasksSetImportantArgsSchema.safeParse([{ id, important: true, title: 'not permitted' }]).success).toBe(false)
  })
})
