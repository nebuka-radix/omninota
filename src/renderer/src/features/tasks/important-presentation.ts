import type { TaskDto } from '../../../../shared/contracts/tasks'
export const IMPORTANT_ON = '#ff6b6b'
export const IMPORTANT_OFF = '#707070'
export function importantTitleStyle(important: boolean, completed: boolean) {
  return {
    fontWeight: important ? 800 : 400,
    color: important ? IMPORTANT_ON : completed ? 'text.secondary' : 'text.primary',
    textDecoration: completed ? important ? 'line-through underline' : 'line-through' : important ? 'underline' : 'none',
    '&:hover': { textDecoration: completed ? 'line-through underline' : 'underline' }
  }
}
export function importantTasks(tasks: readonly TaskDto[]): TaskDto[] {
  return tasks.filter((task) => task.important === true && task.doneOn === null)
}
