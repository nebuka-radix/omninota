import { randomUUID } from 'node:crypto'
import type {
  CreateTaskInput,
  DeleteTaskInput,
  DeleteTaskResult,
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
  milestoneRequired,
  projectCompletedConflict,
  targetMilestoneNotFound,
  targetProjectNotFound,
  taskInCompletedProjectConflict,
  taskNotFound
} from './errors'

// inputはIPC層でZod検証済み（前後空白の除去・空文字と長さ・IDの形式）であること。
// フェーズ5.6: 削除由来で非表示のタスク（hiddenAt あり）は、存在しないものとして扱う（NOT_FOUND。再表示・再利用しない）。
export type TaskService = {
  // 所属は Inbox（projectId・milestoneId ともに省略／null）か、プロジェクトとそのマイルストンの両方（フェーズ5.6）。
  // プロジェクトは存在し未完了であること。マイルストンはそのプロジェクトの表示中のものであること。
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
  // 表示中のタスクの物理削除（フェーズ5.6）。所属・完了状態によらず削除できる。プロジェクトの状態は変えない（自動で完了しない）
  delete(input: DeleteTaskInput): DeleteTaskResult
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

  // 表示中のタスクだけを返す（非表示のタスクは「見つからない」）
  const findOrThrow = (id: string): TaskRow => {
    const row = repository.findById(id)
    if (!row || row.hiddenAt !== null) throw taskNotFound()
    return row
  }

  // 追加・移動先として使える所属か。確認順: 組み合わせの形 → プロジェクトの存在（NOT_FOUND）→ マイルストンの存在（NOT_FOUND）
  // → マイルストンがそのプロジェクトのものか（CONFLICT）→ プロジェクトが未完了か（CONFLICT）。
  // 「マイルストンだけ」「プロジェクトだけ（フェーズ5.6で廃止）」は入力検証で拒否済みだが、ここでも受け付けない。
  // 非表示のマイルストン（project_id がNULL）は存在しないものとして扱う。マイルストンが0件のプロジェクトには所属させられない。
  const assertAssignable = (projectId: string | null, milestoneId: string | null): void => {
    if (projectId === null) {
      if (milestoneId !== null) throw milestoneProjectMismatch()
      return
    }
    if (milestoneId === null) throw milestoneRequired()
    const project = deps.findProject(projectId)
    if (!project) throw targetProjectNotFound()
    const milestone = deps.findMilestone(milestoneId)
    if (!milestone || milestone.projectId === null) throw targetMilestoneNotFound()
    if (milestone.projectId !== projectId) throw milestoneProjectMismatch()
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
          milestoneId,
          hiddenAt: null
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
    },
    delete(input) {
      return transaction(() => {
        // 表示中のタスクだけを削除する（非表示・削除済みは NOT_FOUND。二重実行の2回目も NOT_FOUND）
        if (repository.deleteVisible(input.id) === 0) throw taskNotFound()
        return { id: input.id }
      })
    }
  }
}
