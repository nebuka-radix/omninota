import { randomUUID } from 'node:crypto'
import { INITIAL_MILESTONE_NAME } from '../../shared/contracts/milestones'
import type {
  CreateProjectInput,
  DeleteProjectInput,
  DeleteProjectResult,
  ProjectDeletionSummary,
  ProjectDto,
  RenameProjectInput,
  SetProjectCompletedInput
} from '../../shared/contracts/projects'
import type { MilestoneRow, ProjectRow } from '../db/schema'
import type { RunInTransaction } from '../db/transaction'
import type { ProjectRepository } from '../repositories/project-repository'
import { deletionScopeChanged, projectHasOpenTasks, projectNotFound } from './errors'

// inputはIPC層でZod検証済み（前後空白の除去・空文字と長さ・IDの形式）であること。
export type ProjectService = {
  list(): ProjectDto[]
  // 未完了（done = false・doneOn = null）で作成する。同名のプロジェクトも作成できる。
  // フェーズ5.6: 同じトランザクションで「新しいマイルストン」（通常のマイルストン）を1件作る。どちらか一方だけが残ることはない。
  create(input: CreateProjectInput): ProjectDto
  // 名前が保存済みと同じなら更新しない（updatedAtも変えない）。
  rename(input: RenameProjectInput): ProjectDto
  // 完了・完了の取り消し（フェーズ5.3）。目的の状態を指定する。既にその状態なら更新しない（日時を変えない）。
  // 完了するには、所属する全タスク（画面の絞り込みとは無関係にDBで数える）が完了済みであること。0件なら完了できる。
  // 所属タスクの状態・日時・所属は変えない。タスクが全件完了しても自動では完了しない。
  setCompleted(input: SetProjectCompletedInput): ProjectDto
  // 削除の確認内容（フェーズ5.6）。件数はDBで数える（タスクは既に非表示のものを含む）
  getDeletionSummary(input: { id: string }): ProjectDeletionSummary
  // 削除（フェーズ5.6）。未完了・完了済みのどちらでも削除できる（完了の条件とは無関係）。1つのトランザクションで:
  // 所属タスク（既に非表示のものを含む）の project_id・milestone_id をNULLにして非表示にし、
  // 所属マイルストンの project_id をNULLにし（非表示）、プロジェクトを物理削除する。マイルストン・タスク自体は削除しない。
  // 確認時の件数とDBの件数が違えば、何も変えずに CONFLICT（deletion-scope-changed）。
  delete(input: DeleteProjectInput): DeleteProjectResult
}

function toDto(row: ProjectRow): ProjectDto {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    done: row.done,
    doneOn: row.doneOn
  }
}

export function createProjectService(deps: {
  repository: ProjectRepository
  // 所属する未完了タスクの件数（タスクのRepositoryの countOpenByProject。非表示のタスクは数えない）
  countOpenTasks: (projectId: string) => number
  // 作成時の初期マイルストンの登録（マイルストンのRepositoryの insert。フェーズ5.6）
  insertMilestone: (row: MilestoneRow) => void
  // 削除に使う件数と所属解除（フェーズ5.6）
  countMilestones: (projectId: string) => number
  detachMilestones: (projectId: string, at: string) => number
  countTasks: (projectId: string) => { total: number; hidden: number }
  detachAndHideTasks: (projectId: string, at: string) => number
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
      return deps.transaction(() => {
        const timestamp = now().toISOString()
        const row: ProjectRow = {
          id: generateId(),
          name: input.name,
          createdAt: timestamp,
          updatedAt: timestamp,
          done: false,
          doneOn: null
        }
        repository.insert(row)
        deps.insertMilestone({
          id: generateId(),
          projectId: row.id,
          name: INITIAL_MILESTONE_NAME,
          createdAt: timestamp,
          updatedAt: timestamp,
          done: false,
          doneOn: null,
          // 新しいプロジェクトのカードには手動順がない（作成日時の順。フェーズ5.9）
          position: null
        })
        return toDto(row)
      })
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
        if (current.done === input.completed) return toDto(current)
        if (input.completed) {
          const openTaskCount = deps.countOpenTasks(input.id)
          if (openTaskCount > 0) throw projectHasOpenTasks(openTaskCount)
        }
        const timestamp = now().toISOString()
        // 作成日時・名前は変えない。完了時は done = true と done_on・updatedAt を同じ日時に（同じ更新）。取り消しは false・NULL
        const updated = repository.updateDone(input.id, input.completed ? timestamp : null, timestamp)
        if (!updated) throw projectNotFound()
        return toDto(updated)
      })
    },
    getDeletionSummary(input) {
      return deps.transaction(() => {
        const current = repository.findById(input.id)
        if (!current) throw projectNotFound()
        const tasks = deps.countTasks(input.id)
        return {
          id: current.id,
          name: current.name,
          done: current.done,
          doneOn: current.doneOn,
          milestoneCount: deps.countMilestones(input.id),
          taskCount: tasks.total,
          hiddenTaskCount: tasks.hidden
        }
      })
    },
    delete(input) {
      return deps.transaction(() => {
        // 1. 存在 → 2. 件数が確認時と同じか → 3. タスク・マイルストンの所属解除（非表示化）→ 4. プロジェクトの削除
        // 外部キーの参照を先に外すので、プロジェクトを削除してもマイルストン・タスクは連鎖して削除されない
        if (!repository.findById(input.id)) throw projectNotFound()
        const milestoneCount = deps.countMilestones(input.id)
        const tasks = deps.countTasks(input.id)
        if (milestoneCount !== input.expectedMilestoneCount || tasks.total !== input.expectedTaskCount) {
          throw deletionScopeChanged()
        }
        const timestamp = now().toISOString()
        const taskCount = deps.detachAndHideTasks(input.id, timestamp)
        const detachedMilestones = deps.detachMilestones(input.id, timestamp)
        if (repository.delete(input.id) === 0) throw projectNotFound()
        return { id: input.id, milestoneCount: detachedMilestones, taskCount }
      })
    }
  }
}
