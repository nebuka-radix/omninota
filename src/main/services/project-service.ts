import { randomUUID } from 'node:crypto'
import type {
  CreateProjectInput,
  ProjectDto,
  RenameProjectInput,
  SetProjectCompletedInput
} from '../../shared/contracts/projects'
import type { ProjectRow } from '../db/schema'
import type { RunInTransaction } from '../db/transaction'
import type { ProjectRepository } from '../repositories/project-repository'
import { projectHasOpenTasks, projectNotFound } from './errors'

// inputはIPC層でZod検証済み（前後空白の除去・空文字と長さ・IDの形式）であること。
export type ProjectService = {
  list(): ProjectDto[]
  // 未完了（completedAt = null）で作成する。同名のプロジェクトも作成できる。
  create(input: CreateProjectInput): ProjectDto
  // 名前が保存済みと同じなら更新しない（updatedAtも変えない）。
  rename(input: RenameProjectInput): ProjectDto
  // 完了・完了の取り消し（フェーズ5.3）。目的の状態を指定する。既にその状態なら更新しない（日時を変えない）。
  // 完了するには、所属する全タスク（画面の絞り込みとは無関係にDBで数える）が完了済みであること。0件なら完了できる。
  // 所属タスクの状態・日時・所属は変えない。タスクが全件完了しても自動では完了しない。
  setCompleted(input: SetProjectCompletedInput): ProjectDto
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
  // 所属する未完了タスクの件数（タスクのRepositoryの countOpenByProject）
  countOpenTasks: (projectId: string) => number
  // 確認と更新をまとめるトランザクション
  transaction: RunInTransaction
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
    },
    setCompleted(input) {
      return deps.transaction(() => {
        // 1. 存在 → 2. 同じ状態なら変更なし → 3. 完了時は未完了タスクの有無 → 4. 更新
        const current = repository.findById(input.id)
        if (!current) throw projectNotFound()
        if ((current.completedAt !== null) === input.completed) return toDto(current)
        if (input.completed) {
          const openTaskCount = deps.countOpenTasks(input.id)
          if (openTaskCount > 0) throw projectHasOpenTasks(openTaskCount)
        }
        const timestamp = now().toISOString()
        // 作成日時・名前は変えない。完了時は completedAt と updatedAt を同じ日時にする
        const updated = repository.updateCompletedAt(input.id, input.completed ? timestamp : null, timestamp)
        if (!updated) throw projectNotFound()
        return toDto(updated)
      })
    }
  }
}
