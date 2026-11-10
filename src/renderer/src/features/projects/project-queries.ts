import { queryOptions, useMutation, useMutationState, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  CreateProjectInput,
  DeleteProjectInput,
  ProjectDeletionSummary,
  ProjectDto,
  RenameProjectInput,
  SetProjectCompletedInput
} from '../../../../shared/contracts/projects'
import { unwrapIpc } from '../../lib/ipc'
import { milestoneKeys } from '../milestones/milestone-queries'
import { taskKeys } from '../tasks/task-queries'
import { projectSaveKey, taskSaveQueue } from '../tasks/task-save-queue'

export const projectKeys = {
  all: ['projects'] as const,
  list: () => [...projectKeys.all, 'list'] as const
}

export const projectMutationKeys = {
  create: [...projectKeys.all, 'create'] as const,
  rename: [...projectKeys.all, 'rename'] as const,
  setCompleted: [...projectKeys.all, 'set-completed'] as const,
  delete: [...projectKeys.all, 'delete'] as const
}

// プロジェクト一覧（全件・少量）。個別の詳細Queryは作らず、この一覧から探す。
export const projectListQueryOptions = queryOptions({
  queryKey: projectKeys.list(),
  queryFn: () => unwrapIpc(window.gtd.projects.list())
})

// 保存後のDTOで一覧の該当行だけを置き換える（再取得しない。タスクのキャッシュは変えない）。
// 一覧の再取得が進行中なら、更新前の結果で上書きされないよう取り直す。
function replaceProjectInList(queryClient: QueryClient, saved: ProjectDto): void {
  queryClient.setQueryData<ProjectDto[]>(projectKeys.list(), (projects) =>
    projects?.map((project) => (project.id === saved.id ? saved : project))
  )
  if (queryClient.isFetching({ queryKey: projectKeys.list() }) > 0) {
    void queryClient.invalidateQueries({ queryKey: projectKeys.list() })
  }
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: projectMutationKeys.create,
    mutationFn: (input: CreateProjectInput) => unwrapIpc(window.gtd.projects.create(input)),
    // 作成時に初期マイルストン（「新しいマイルストン」）も同じトランザクションで作られる（フェーズ5.6）。両方を取り直す
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.list() }),
        queryClient.invalidateQueries({ queryKey: milestoneKeys.list() })
      ])
  })
}

// 同じプロジェクトの更新（名前・完了状態）は順番に1つずつ送る（フェーズ5.3。タスクと同じ保存キュー）。
// 各応答は保存後のプロジェクト全体なので、後の応答が常に新しく、古いDTOで別の項目を上書きしない。
export function useRenameProjectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: projectMutationKeys.rename,
    mutationFn: (input: RenameProjectInput) =>
      taskSaveQueue.run(projectSaveKey(input.id), () => unwrapIpc(window.gtd.projects.rename(input))),
    onSuccess: (saved: ProjectDto) => replaceProjectInList(queryClient, saved)
  })
}

// 完了・完了の取り消し（フェーズ5.3）。保存に成功した後だけ表示を切り替える（楽観的更新はしない）。
export function useSetProjectCompletedMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: projectMutationKeys.setCompleted,
    mutationFn: (input: SetProjectCompletedInput) =>
      taskSaveQueue.run(projectSaveKey(input.id), () => unwrapIpc(window.gtd.projects.setCompleted(input))),
    onSuccess: (saved: ProjectDto) => replaceProjectInList(queryClient, saved)
  })
}

// 削除の確認内容（フェーズ5.6）。件数はDBで数える（既に非表示の所属タスクを含む）。キャッシュしない
export function fetchProjectDeletionSummary(id: string): Promise<ProjectDeletionSummary> {
  return unwrapIpc(window.gtd.projects.getDeletionSummary({ id }))
}

// 削除（フェーズ5.6）。同じプロジェクトの更新（名前・完了状態）の後に実行する。
// 成功したら一覧から除外し、プロジェクト・マイルストン・タスクの一覧をDBから取り直す（配下は非表示になり、どこにも出なくなる）
export function useDeleteProjectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: projectMutationKeys.delete,
    mutationFn: (input: DeleteProjectInput) =>
      taskSaveQueue.run(projectSaveKey(input.id), () => unwrapIpc(window.gtd.projects.delete(input))),
    // 取り直しの完了は待たない（呼び出し側が、すぐに安全な画面へ移れるようにする）
    onSuccess: (result) => {
      queryClient.setQueryData<ProjectDto[]>(projectKeys.list(), (projects) => projects?.filter((project) => project.id !== result.id))
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: projectKeys.list() }),
        queryClient.invalidateQueries({ queryKey: milestoneKeys.list() }),
        queryClient.invalidateQueries({ queryKey: taskKeys.list() })
      ])
    }
  })
}

// 更新中（名前・完了状態・削除）のプロジェクトID。同じプロジェクトへの重複操作を制限するために使う。
export function usePendingProjectIds(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: {
      status: 'pending',
      predicate: (mutation) => {
        const key = mutation.options.mutationKey
        return (
          key !== undefined &&
          key[0] === projectKeys.all[0] &&
          (key[1] === projectMutationKeys.rename[1] ||
            key[1] === projectMutationKeys.setCompleted[1] ||
            key[1] === projectMutationKeys.delete[1])
        )
      }
    },
    select: (mutation) => {
      const variables = mutation.state.variables
      return typeof variables === 'object' && variables !== null && 'id' in variables && typeof variables.id === 'string'
        ? variables.id
        : null
    }
  })
  const set = new Set<string>()
  for (const id of ids) if (id) set.add(id)
  return set
}
