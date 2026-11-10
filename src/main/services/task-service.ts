import { randomUUID } from 'node:crypto'
import type {
  CreateTaskInput,
  SetTaskCompletedInput,
  SetTaskProjectInput,
  TaskDto,
  UpdateTaskTitleInput
} from '../../shared/contracts/tasks'
import type { ProjectRow, TaskRow } from '../db/schema'
import type { RunInTransaction } from '../db/transaction'
import type { TaskRepository } from '../repositories/task-repository'
import {
  projectCompletedConflict,
  targetProjectNotFound,
  taskInCompletedProjectConflict,
  taskNotFound
} from './errors'

// inputはIPC層でZod検証済み（前後空白の除去・空文字と長さ・IDの形式）であること。
export type TaskService = {
  // projectId を指定すると、そのプロジェクトに所属させて作成する（存在し、未完了であること）。省略・nullなら未所属。
  create(input: CreateTaskInput): TaskDto
  list(): TaskDto[]
  // タイトルが保存済みと同じなら更新しない（updatedAtも変えない）。
  updateTitle(input: UpdateTaskTitleInput): TaskDto
  // 目的の状態を指定する。既にその状態なら更新しない（日時を変えない）。
  // 完了済みプロジェクトに所属するタスクは未完了に戻せない（CONFLICT。フェーズ5.3）。完了にするのは常に可能。
  setCompleted(input: SetTaskCompletedInput): TaskDto
  // 所属の変更・解除。既に同じ所属なら更新しない（移動先の確認より先に判定する。完了済みプロジェクトへの再要求もエラーにしない）。
  // 移動先は存在し、未完了であること。完了済みプロジェクトから外（未所属・別の未完了プロジェクト）への移動は許可する。
  setProject(input: SetTaskProjectInput): TaskDto
}

// DBの行型をそのまま画面へ渡さず、契約上のDTOへ詰め替える。
function toDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    projectId: row.projectId
  }
}

export function createTaskService(deps: {
  repository: TaskRepository
  // 所属先の確認に使う（プロジェクトのRepositoryの findById）
  findProject: (id: string) => ProjectRow | undefined
  // 参照先の確認と更新をまとめるトランザクション
  transaction: RunInTransaction
  now?: () => Date
  generateId?: () => string
}): TaskService {
  const now = deps.now ?? (() => new Date())
  const generateId = deps.generateId ?? (() => randomUUID())
  const { repository, transaction } = deps

  const findOrThrow = (id: string): TaskRow => {
    const row = repository.findById(id)
    if (!row) throw taskNotFound()
    return row
  }

  // 追加・移動先として使えるプロジェクトか（存在する → NOT_FOUND、未完了 → CONFLICT の順に確認）
  const assertAssignable = (projectId: string): void => {
    const project = deps.findProject(projectId)
    if (!project) throw targetProjectNotFound()
    if (project.completedAt !== null) throw projectCompletedConflict()
  }

  return {
    create(input) {
      const projectId = input.projectId ?? null
      return transaction(() => {
        if (projectId !== null) assertAssignable(projectId)
        const timestamp = now().toISOString()
        const row: TaskRow = {
          id: generateId(),
          title: input.title,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
          projectId
        }
        repository.insert(row)
        return toDto(row)
      })
    },
    list() {
      return repository.listAll().map(toDto)
    },
    updateTitle(input) {
      const current = findOrThrow(input.id)
      if (current.title === input.title) return toDto(current)
      // 完了日時・作成日時・所属は変えない
      const updated = repository.updateTitle(input.id, input.title, now().toISOString())
      if (!updated) throw taskNotFound()
      return toDto(updated)
    },
    setCompleted(input) {
      return transaction(() => {
        // 1. タスクの存在 → 2. 同じ状態なら変更なし → 3. 未完了に戻す場合は所属プロジェクトが未完了か → 4. 更新
        const current = findOrThrow(input.id)
        const isCompleted = current.completedAt !== null
        if (isCompleted === input.completed) return toDto(current)
        if (!input.completed && current.projectId !== null) {
          const project = deps.findProject(current.projectId)
          if (project && project.completedAt !== null) throw taskInCompletedProjectConflict()
        }
        const timestamp = now().toISOString()
        const updated = repository.updateCompletedAt(input.id, input.completed ? timestamp : null, timestamp)
        if (!updated) throw taskNotFound()
        return toDto(updated)
      })
    },
    setProject(input) {
      return transaction(() => {
        // 1. タスクの存在 → 2. 同じ所属なら変更なし → 3. 移動先の存在・未完了 → 4. 更新
        const current = findOrThrow(input.id)
        if (current.projectId === input.projectId) return toDto(current)
        if (input.projectId !== null) assertAssignable(input.projectId)
        // ID・作成日時・完了日時・タイトルは変えない
        const updated = repository.updateProjectId(input.id, input.projectId, now().toISOString())
        if (!updated) throw taskNotFound()
        return toDto(updated)
      })
    }
  }
}
