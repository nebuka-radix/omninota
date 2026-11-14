import type { TaskDto } from '../../../../shared/contracts/tasks'

// Only the Important section may use importance as an ordering criterion.
// Equal priorities preserve the input order; never mutate query-cache arrays.
export function orderDayTasks<T extends Pick<TaskDto, 'important' | 'favorite'>>(
  tasks: readonly T[], importantSection: boolean
): T[] {
  return tasks.map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const important = importantSection
        ? Number(right.task.important === true) - Number(left.task.important === true)
        : 0
      return important || Number(right.task.favorite === true) - Number(left.task.favorite === true) || left.index - right.index
    })
    .map(({ task }) => task)
}
