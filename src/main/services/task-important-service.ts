import type { SetTaskImportantInput, TaskDto } from '../../shared/contracts/tasks'
import type { RunInTransaction } from '../db/transaction'
import type { TaskImportantRepository } from '../repositories/task-important-repository'
import { taskNotFound } from './errors'
import { toTaskDto } from './task-service'
export function createTaskImportantService(deps: { repository: TaskImportantRepository; transaction: RunInTransaction; now?: () => Date }) {
  const now = deps.now ?? (() => new Date())
  return {
    set(input: SetTaskImportantInput): TaskDto {
      return deps.transaction(() => {
        const previous = deps.repository.find(input.id)
        if (!previous) throw taskNotFound()
        if (previous.important === input.important) return toTaskDto(previous)
        const row = deps.repository.update(input.id, input.important, now().toISOString())
        if (!row) throw taskNotFound()
        return toTaskDto(row)
      })
    }
  }
}
