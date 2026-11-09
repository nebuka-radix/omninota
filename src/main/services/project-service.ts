import { randomUUID } from 'node:crypto'
import type { CreateProjectInput, ProjectDto, RenameProjectInput } from '../../shared/contracts/projects'
import type { ProjectRow } from '../db/schema'
import type { ProjectRepository } from '../repositories/project-repository'
import { projectNotFound } from './errors'

// inputはIPC層でZod検証済み（前後空白の除去・空文字と長さ・IDの形式）であること。
export type ProjectService = {
  list(): ProjectDto[]
  // 未完了（completedAt = null）で作成する。同名のプロジェクトも作成できる。
  create(input: CreateProjectInput): ProjectDto
  // 名前が保存済みと同じなら更新しない（updatedAtも変えない）。
  rename(input: RenameProjectInput): ProjectDto
}

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt
  }
}

export function createProjectService(deps: {
  repository: ProjectRepository
  now?: () => Date
  generateId?: () => string
}): ProjectService {
  const now = deps.now ?? (() => new Date())
  const generateId = deps.generateId ?? (() => randomUUID())
  const { repository } = deps

  return {
    list() {
      return repository.listAll().map(toDto)
    },
    create(input) {
      const timestamp = now().toISOString()
      const row: ProjectRow = {
        id: generateId(),
        name: input.name,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null
      }
      repository.insert(row)
      return toDto(row)
    },
    rename(input) {
      const current = repository.findById(input.id)
      if (!current) throw projectNotFound()
      if (current.name === input.name) return toDto(current)
      const updated = repository.updateName(input.id, input.name, now().toISOString())
      if (!updated) throw projectNotFound()
      return toDto(updated)
    }
  }
}
