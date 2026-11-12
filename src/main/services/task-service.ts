import { randomUUID } from 'node:crypto'
import { addDaysToDateOnly, localDateOnly } from '../../shared/date-only'
import type {
  AssignInboxTasksInput,
  CreateTaskInput,
  DeleteTaskInput,
  DeleteTaskResult,
  DeleteTasksInput,
  DeleteTasksResult,
  ReorderMilestoneTasksInput,
  SetTaskDueInput,
  SetTaskFavoriteInput,
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
  orderChanged,
  projectCompletedConflict,
  someTasksNotFound,
  targetMilestoneNotFound,
  targetProjectNotFound,
  taskInCompletedProjectConflict,
  taskNotFound,
  tasksNotInInbox
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
  // --- フェーズ5.9 ---
  // Inboxの複数タスクを1つのマイルストンへ紐付ける。1つのトランザクションで、確認してから全件を更新する。
  // 確認: 全件が存在し表示中か（NOT_FOUND）→ 全件が現在Inboxか（CONFLICT）→ 移動先（assertAssignable と同じ）。
  // 1件でも満たさなければ何も変更しない。ids の順に、移動先の手動順（ある場合）の末尾へ追加する。
  // タイトル・完了状態・作成日時は変えない（updated_at は所属の変更として操作日時にする。setAssignment と同じ）
  assignFromInbox(input: AssignInboxTasksInput): TaskDto[]
  // 表示中の複数タスクの物理削除。全件が存在し表示中でなければ、何も削除しない（NOT_FOUND）
  deleteMany(input: DeleteTasksInput): DeleteTasksResult
  // マイルストン内のタスクの手動順を保存する。orderedIds がDBの表示中の所属タスク全件と一致しなければ CONFLICT（order-changed）。
  // 順位だけを書き換え、updated_at などの日時は変えない。そのマイルストンの表示中のタスク全件（新しい順序）を返す
  reorderInMilestone(input: ReorderMilestoneTasksInput): TaskDto[]
  // 期限の設定・変更・解除（フェーズ6）。「今日」「明日」は操作の時点（now）のローカルの暦日で決める。
  // 表示中のタスクだけ（非表示・削除済みは NOT_FOUND。遅れた保存で対象を作り直さない）。期限だけを更新し、
  // タイトル・所属・完了状態・手動順は変えない。同じ期限なら更新しない（updatedAt も変えない）
  setDue(input: SetTaskDueInput): TaskDto
  // お気に入りの設定・解除。表示中のタスクだけ（非表示・削除済みは NOT_FOUND。遅れた保存で対象を作り直さない）。
  // お気に入りだけを更新し、他の項目は変えない。同じ値なら更新しない（updatedAt も変えない）
  setFavorite(input: SetTaskFavoriteInput): TaskDto
}

// DBの行型をそのまま画面へ渡さず、契約上のDTOへ詰め替える（Summary Review でも使う）。
export function toTaskDto(row: TaskRow): TaskDto {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    doneOn: row.doneOn,
    projectId: row.projectId,
    milestoneId: row.milestoneId,
    position: row.position,
    dueto: row.dueto,
    favorite: row.favorite
  }
}
const toDto = toTaskDto

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
    if (project.done) throw projectCompletedConflict()
  }

  // 移動先のマイルストンに追加する時の手動順（フェーズ5.9）。手動順がなければ null（作成日時の順に従う）、あれば末尾（最大値+1）
  const nextPosition = (milestoneId: string | null): number | null => {
    if (milestoneId === null) return null
    const current = repository.maxPositionInMilestone(milestoneId)
    return current === null ? null : current + 1
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
          doneOn: null,
          projectId,
          milestoneId,
          hiddenAt: null,
          position: nextPosition(milestoneId),
          // 期限は作成時には設定しない（作成日時などから補完しない）
          dueto: null,
          favorite: false
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
        const isCompleted = current.doneOn !== null
        if (isCompleted === input.completed) return toDto(current)
        if (!input.completed && current.projectId !== null) {
          const project = deps.findProject(current.projectId)
          if (project && project.done) throw taskInCompletedProjectConflict()
        }
        const timestamp = now().toISOString()
        const updated = repository.updateDoneOn(input.id, input.completed ? timestamp : null, timestamp)
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
        // 手動順のあるマイルストンへは末尾に追加し、Inboxへ戻す時は手動順を外す（フェーズ5.9）
        const updated = repository.updateAssignment(
          input.id,
          input.projectId,
          input.milestoneId,
          nextPosition(input.milestoneId),
          now().toISOString()
        )
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
    },
    assignFromInbox(input) {
      return transaction(() => {
        const rows = new Map(repository.findManyByIds(input.ids).map((row) => [row.id, row]))
        const current = input.ids.map((id) => rows.get(id))
        if (current.some((row) => row === undefined || row.hiddenAt !== null)) throw someTasksNotFound()
        if (current.some((row) => row!.projectId !== null || row!.milestoneId !== null)) throw tasksNotInInbox()
        assertAssignable(input.projectId, input.milestoneId)
        const timestamp = now().toISOString()
        let position = repository.maxPositionInMilestone(input.milestoneId)
        return input.ids.map((id) => {
          if (position !== null) position += 1
          const updated = repository.updateAssignment(id, input.projectId, input.milestoneId, position, timestamp)
          // 確認後に変わることはない（同じトランザクション）。万一の場合は例外で全体を取り消す
          if (!updated) throw someTasksNotFound()
          return toDto(updated)
        })
      })
    },
    deleteMany(input) {
      return transaction(() => {
        const rows = repository.findManyByIds(input.ids)
        if (rows.length !== input.ids.length || rows.some((row) => row.hiddenAt !== null)) throw someTasksNotFound()
        if (repository.deleteVisibleMany(input.ids) !== input.ids.length) throw someTasksNotFound()
        return { ids: [...input.ids] }
      })
    },
    reorderInMilestone(input) {
      return transaction(() => {
        const milestone = deps.findMilestone(input.milestoneId)
        if (!milestone || milestone.projectId === null) throw targetMilestoneNotFound()
        const current = repository.listVisibleByMilestone(input.milestoneId)
        const currentIds = new Set(current.map((row) => row.id))
        // 一部だけ（絞り込み中の表示行など）・別のタスクを含む指定では、表示していないタスクの順位を壊さないよう保存しない
        if (current.length !== input.orderedIds.length || input.orderedIds.some((id) => !currentIds.has(id))) {
          throw orderChanged('task')
        }
        input.orderedIds.forEach((id, index) => {
          if (repository.updatePosition(id, index) !== 1) throw orderChanged('task')
        })
        return repository.listVisibleByMilestone(input.milestoneId).map(toDto)
      })
    },
    setDue(input) {
      return transaction(() => {
        const current = findOrThrow(input.id)
        const at = now()
        const today = localDateOnly(at)
        const dueto =
          input.due.kind === 'today'
            ? today
            : input.due.kind === 'tomorrow'
              ? addDaysToDateOnly(today, 1)
              : input.due.kind === 'date'
                ? input.due.date
                : null
        if (current.dueto === dueto) return toDto(current)
        const updated = repository.updateDue(input.id, dueto, at.toISOString())
        if (!updated) throw taskNotFound()
        return toDto(updated)
      })
    },
    setFavorite(input) {
      return transaction(() => {
        const current = findOrThrow(input.id)
        if (current.favorite === input.favorite) return toDto(current)
        const updated = repository.updateFavorite(input.id, input.favorite, now().toISOString())
        if (!updated) throw taskNotFound()
        return toDto(updated)
      })
    }
  }
}
