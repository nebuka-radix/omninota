import { describe, expect, it } from 'vitest'
import { orderDayTasks } from '../../src/renderer/src/features/summary/day-task-order'

describe('THE DAY section task ordering', () => {
  it('prioritizes importance then favorite in the Important section', () => {
    const tasks = [
      { id: 'normal-favorite', important: false, favorite: true },
      { id: 'important', important: true, favorite: false },
      { id: 'both', important: true, favorite: true },
      { id: 'normal', important: false, favorite: false }
    ]
    expect(orderDayTasks(tasks, true).map((task) => task.id)).toEqual(['both', 'important', 'normal-favorite', 'normal'])
  })
  it('orders an actual all-important section by favorite', () => {
    const tasks = [
      { id: 'a', important: true, favorite: false },
      { id: 'b', important: true, favorite: true },
      { id: 'c', important: true, favorite: false }
    ]
    expect(orderDayTasks(tasks, true).map((task) => task.id)).toEqual(['b', 'a', 'c'])
  })
  it('ignores importance outside the Important section', () => {
    const tasks = [
      { id: 'important-only', important: true, favorite: false },
      { id: 'favorite-only', important: false, favorite: true },
      { id: 'normal', important: false, favorite: false },
      { id: 'both', important: true, favorite: true }
    ]
    expect(orderDayTasks(tasks, false).map((task) => task.id)).toEqual(['favorite-only', 'both', 'important-only', 'normal'])
  })
  it('preserves tie order and leaves the input unchanged', () => {
    const tasks = Object.freeze([
      Object.freeze({ id: 'b', important: true, favorite: true }),
      Object.freeze({ id: 'a', important: true, favorite: true }),
      Object.freeze({ id: 'd', important: true, favorite: false }),
      Object.freeze({ id: 'c', important: true, favorite: false })
    ])
    const result = orderDayTasks(tasks, true)
    expect(result.map((task) => task.id)).toEqual(['b', 'a', 'd', 'c'])
    expect(tasks.map((task) => task.id)).toEqual(['b', 'a', 'd', 'c'])
    expect(result).not.toBe(tasks)
  })
  it('supports empty sections', () => expect(orderDayTasks([], false)).toEqual([]))
})
