import { randomUUID } from 'node:crypto'
import type {
  CreateTaskInput,
  SetTaskAssignmentInput,
  SetTaskCompletedInput,
  TaskDto,
  UpdateTaskTitleInput
} from '../../shared/contracts/tasks'
import type { MilestoneRow, ProjectRow, TaskRow } from '../db/schema'
import type { RunInTransaction } from '../db/transaction'
import type { TaskRepository } from '../repositories/task-repository'
import {
  milestoneProjectMismatch,
  projectCompletedConflict,
  targetMilestoneNotFound,
  targetProjectNotFound,
  taskInCompletedProjectConflict,
  taskNotFound
} from './errors'

// inputはIPC層でZod検証済み（前後空白の除去・空文字と長さ・IDの形式）であること。
export type TaskService = {
  // projectId を指定すると、そのプロジェクトに所属させて作成する（存在し、未完了であること）。省略・nullなら未所属。
  // milestoneId を指定する場合は、projectId のプロジェクトに属するマイルストンであること（フェーズ5.4）。
  create(input: CreateTaskInput): TaskDto
  list(): TaskDto[]
  // タイトルが保存済みと同じなら更新しない（updatedAtも変えない）。
  updateTitle(input: UpdateTaskTitleInput): TaskDto
  // 目的の状態を指定する。既にその状態なら更新しない（日時を変えない）。
  // 完了済みプロジェクトに所属するタスクは未完了に戻せない（CONFLICT。フェーズ5.3）。完了にするのは常に可能。
  setCompleted(input: SetTaskCompletedInput): TaskDto
  // 所属（プロジェクト・マイルストン）の変更・解除を1回で保存する（フェーズ5.4。5.2の setProject を置き換え）。
  // 既に同じ所属なら更新しない（移動先の確認より先に判定する。完了済みプロジェクトへの同じ所属の再要求もエラーにしない）。
  // 移動先は存在し、未完了であること。マイルストンはそのプロジェクトのものであること。
  // 完了済みプロジェクトから外（未所属・別の未完了プロジェクト）への移動は許可する。
  setAssignment(input: SetTaskAssignmentInput): TaskDto
}

// DBの行型をそのまま画面へ渡さず、契約上のDTOへ詰め替える。
function toDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    projectId: row.projectId,
    milestoneId: row.milestoneId
  }
}

export function createTaskService(deps: {
  repository: TaskRepository
  // 所属先の確認に使う（プロジェクト・マイルストンのRepositoryの findById）
  findProject: (id: string) => ProjectRow | undefined
  findMilestone: (id: string) => MilestoneRow | undefined
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

  // 追加・移動先として使える所属か。確認順: プロジェクトの存在（NOT_FOUND）→ マイルストンの存在（NOT_FOUND）
  // → マイルストンがそのプロジェクトのものか（CONFLICT）→ プロジェクトが未完了か（CONFLICT）。
  // 「マイルストンだけ（プロジェクトなし）」は入力検証で拒否済みだが、ここでも受け付けない。
  const assertAssignable = (projectId: string | null, milestoneId: string | null): void => {
    if (projectId === null) {
      if (milestoneId !== null) throw milestoneProjectMismatch()
      return
    }
    const project = deps.findProject(projectId)
    if (!project) throw targetProjectNotFound()
    if (milestoneId !== null) {
      const milestone = deps.findMilestone(milestoneId)
      if (!milestone) throw targetMilestoneNotFound()
      if (milestone.projectId !== projectId) throw milestoneProjectMismatch()
    }
    if (project.completedAt !== null) throw projectCompletedConflict()
  }

  return {
    create(input) {
      const projectId = input.projectId ?? null
      const milestoneId = input.milestoneId ?? null
      return transaction(() => {
        assertAssignable(projectId, milestoneId)
        const timestamp = now().toISOString()
        const row: TaskRow = {
          id: generateId(),
          title: input.title,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
          projectId,
          milestoneId
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
    setAssignment(input) {
      return transaction(() => {
        // 1. タスクの存在 → 2. 同じ所属（プロジェクトとマイルストンの両方）なら変更なし → 3. 移動先の確認 → 4. 更新
        const current = findOrThrow(input.id)
        if (current.projectId === input.projectId && current.milestoneId === input.milestoneId) return toDto(current)
        assertAssignable(input.projectId, input.milestoneId)
        // プロジェクトとマイルストンを1回の更新で書き換える（旧プロジェクトのマイルストンを残さない）。
        // ID・作成日時・完了日時・タイトルは変えない
        const updated = repository.updateAssignment(input.id, input.projectId, input.milestoneId, now().toISOString())
        if (!updated) throw taskNotFound()
        return toDto(updated)
      })
    }
  }
}
