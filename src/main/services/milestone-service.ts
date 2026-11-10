import { randomUUID } from 'node:crypto'
import type {
  CreateMilestoneInput,
  DeleteMilestoneInput,
  DeleteMilestoneResult,
  MilestoneDeletionSummary,
  MilestoneDto,
  RenameMilestoneInput
} from '../../shared/contracts/milestones'
import type { MilestoneRow, ProjectRow } from '../db/schema'
import type { RunInTransaction } from '../db/transaction'
import type { MilestoneRepository } from '../repositories/milestone-repository'
import { deletionScopeChanged, milestoneInCompletedProjectConflict, milestoneNotFound, targetProjectNotFound } from './errors'

// inputはIPC層でZod検証済み（前後空白の除去・空白のみの拒否・長さ・IDの形式）であること。
// フェーズ5.6: プロジェクトの削除で非表示になったマイルストン（project_id がNULL）は、存在しないものとして扱う（NOT_FOUND）。
export type MilestoneService = {
  list(): MilestoneDto[]
  // 所属プロジェクトが存在し、未完了であること（完了済みプロジェクトへの追加は CONFLICT）。同名は許可する。
  create(input: CreateMilestoneInput): MilestoneDto
  // 同じ名前なら更新しない（updatedAtも変えない）。完了済みプロジェクトのマイルストンでも名前は変更できる。
  rename(input: RenameMilestoneInput): MilestoneDto
  // 削除の確認内容（フェーズ5.6）。件数はDBの所属タスクの総数（完了済み・検索で隠れているものを含む）
  getDeletionSummary(input: { id: string }): MilestoneDeletionSummary
  // 削除（フェーズ5.6）。1つのトランザクションで、所属タスクの milestone_id をNULLにして非表示にし（project_id は残す。
  // タスク自体は削除しない）、マイルストンを物理削除する。最後の1件でも削除でき、代わりのマイルストンは作らない。
  // 確認時の件数（expectedTaskCount）とDBの件数が違えば、何も変えずに CONFLICT（deletion-scope-changed）。
  // 完了済みプロジェクトのマイルストンも削除できる（完了状態は変えない）。
  delete(input: DeleteMilestoneInput): DeleteMilestoneResult
}

// project_id があるもの（表示中）だけをDTOにする
type VisibleMilestoneRow = MilestoneRow & { projectId: string }
const isVisible = (row: MilestoneRow | undefined): row is VisibleMilestoneRow => row !== undefined && row.projectId !== null

function toDto(row: VisibleMilestoneRow): MilestoneDto {
  return { id: row.id, projectId: row.projectId, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

export function createMilestoneService(deps: {
  repository: MilestoneRepository
  findProject: (id: string) => ProjectRow | undefined
  // 所属タスクの件数と、所属解除・非表示化（タスクのRepository）
  countTasks: (milestoneId: string) => number
  hideTasks: (milestoneId: string, at: string) => number
  transaction: RunInTransaction
  now?: () => Date
  generateId?: () => string
}): MilestoneService {
  const now = deps.now ?? (() => new Date())
  const generateId = deps.generateId ?? (() => randomUUID())
  const { repository } = deps

  const findVisible = (id: string): VisibleMilestoneRow => {
    const row = repository.findById(id)
    if (!isVisible(row)) throw milestoneNotFound()
    return row
  }

  return {
    list() {
      return repository.listAll().filter(isVisible).map(toDto)
    },
    create(input) {
      return deps.transaction(() => {
        const project = deps.findProject(input.projectId)
        if (!project) throw targetProjectNotFound()
        if (project.completedAt !== null) throw milestoneInCompletedProjectConflict()
        const timestamp = now().toISOString()
        const row: VisibleMilestoneRow = {
          id: generateId(),
          projectId: input.projectId,
          name: input.name,
          createdAt: timestamp,
          updatedAt: timestamp
        }
        repository.insert(row)
        return toDto(row)
      })
    },
    rename(input) {
      const current = findVisible(input.id)
      if (current.name === input.name) return toDto(current)
      const updated = repository.updateName(input.id, input.name, now().toISOString())
      if (!isVisible(updated)) throw milestoneNotFound()
      return toDto(updated)
    },
    getDeletionSummary(input) {
      return deps.transaction(() => {
        const current = findVisible(input.id)
        return { id: current.id, name: current.name, taskCount: deps.countTasks(current.id) }
      })
    },
    delete(input) {
      return deps.transaction(() => {
        // 1. 存在（表示中）→ 2. 件数が確認時と同じか → 3. 所属解除・非表示化 → 4. マイルストンの削除
        findVisible(input.id)
        const taskCount = deps.countTasks(input.id)
        if (taskCount !== input.expectedTaskCount) throw deletionScopeChanged()
        const hiddenTaskCount = deps.hideTasks(input.id, now().toISOString())
        if (repository.deleteVisible(input.id) === 0) throw milestoneNotFound()
        return { id: input.id, hiddenTaskCount }
      })
    }
  }
}
