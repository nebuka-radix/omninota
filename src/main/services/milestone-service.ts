import { randomUUID } from 'node:crypto'
import type { CreateMilestoneInput, MilestoneDto, RenameMilestoneInput } from '../../shared/contracts/milestones'
import type { MilestoneRow, ProjectRow } from '../db/schema'
import type { RunInTransaction } from '../db/transaction'
import type { MilestoneRepository } from '../repositories/milestone-repository'
import { milestoneInCompletedProjectConflict, milestoneNotFound, targetProjectNotFound } from './errors'

// inputはIPC層でZod検証済み（前後空白の除去・空白のみの拒否・長さ・IDの形式）であること。
export type MilestoneService = {
  list(): MilestoneDto[]
  // 所属プロジェクトが存在し、未完了であること（完了済みプロジェクトへの追加は CONFLICT）。同名は許可する。
  create(input: CreateMilestoneInput): MilestoneDto
  // 同じ名前なら更新しない（updatedAtも変えない）。完了済みプロジェクトのマイルストンでも名前は変更できる。
  rename(input: RenameMilestoneInput): MilestoneDto
}

function toDto(row: MilestoneRow): MilestoneDto {
  return { id: row.id, projectId: row.projectId, name: row.name, createdAt: row.createdAt, updatedAt: row.updatedAt }
}

export function createMilestoneService(deps: {
  repository: MilestoneRepository
  findProject: (id: string) => ProjectRow | undefined
  transaction: RunInTransaction
  now?: () => Date
  generateId?: () => string
}): MilestoneService {
  const now = deps.now ?? (() => new Date())
  const generateId = deps.generateId ?? (() => randomUUID())
  const { repository } = deps

  return {
    list() {
      return repository.listAll().map(toDto)
    },
    create(input) {
      return deps.transaction(() => {
        const project = deps.findProject(input.projectId)
        if (!project) throw targetProjectNotFound()
        if (project.completedAt !== null) throw milestoneInCompletedProjectConflict()
        const timestamp = now().toISOString()
        const row: MilestoneRow = {
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
      const current = repository.findById(input.id)
      if (!current) throw milestoneNotFound()
      if (current.name === input.name) return toDto(current)
      const updated = repository.updateName(input.id, input.name, now().toISOString())
      if (!updated) throw milestoneNotFound()
      return toDto(updated)
    }
  }
}
