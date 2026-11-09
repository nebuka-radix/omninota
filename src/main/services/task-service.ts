import { randomUUID } from 'node:crypto'
import type {
  CreateTaskInput,
  SetTaskCompletedInput,
  TaskDto,
  UpdateTaskTitleInput
} from '../../shared/contracts/tasks'
import type { TaskRow } from '../db/schema'
import type { TaskRepository } from '../repositories/task-repository'
import { taskNotFound } from './errors'

// inputはIPC層でZod検証済み（前後空白の除去・空文字と長さ・IDの形式）であること。
export type TaskService = {
  create(input: CreateTaskInput): TaskDto
  list(): TaskDto[]
  // タイトルが保存済みと同じなら更新しない（updatedAtも変えない）。
  updateTitle(input: UpdateTaskTitleInput): TaskDto
  // 目的の状態を指定する。既にその状態なら更新しない（日時を変えない）。
  setCompleted(input: SetTaskCompletedInput): TaskDto
}

// DBの行型をそのまま画面へ渡さず、契約上のDTOへ詰め替える。
function toDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt
  }
}

export function createTaskService(deps: {
  repository: TaskRepository
  now?: () => Date
  generateId?: () => string
}): TaskService {
  const now = deps.now ?? (() => new Date())
  const generateId = deps.generateId ?? (() => randomUUID())
  const { repository } = deps

  const findOrThrow = (id: string): TaskRow => {
    const row = repository.findById(id)
    if (!row) throw taskNotFound()
    return row
  }

  return {
    create(input) {
      const timestamp = now().toISOString()
      const row: TaskRow = {
        id: generateId(),
        title: input.title,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null
      }
      repository.insert(row)
      return toDto(row)
    },
    list() {
      return repository.listAll().map(toDto)
    },
    updateTitle(input) {
      const current = findOrThrow(input.id)
      if (current.title === input.title) return toDto(current)
      // 完了日時・作成日時は変えない
      const updated = repository.updateTitle(input.id, input.title, now().toISOString())
      if (!updated) throw taskNotFound()
      return toDto(updated)
    },
    setCompleted(input) {
      const current = findOrThrow(input.id)
      const isCompleted = current.completedAt !== null
      if (isCompleted === input.completed) return toDto(current)
      const timestamp = now().toISOString()
      const updated = repository.updateCompletedAt(input.id, input.completed ? timestamp : null, timestamp)
      if (!updated) throw taskNotFound()
      return toDto(updated)
    }
  }
}
