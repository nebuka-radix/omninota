import { queryOptions, useMutation, useMutationState, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  CreateTaskInput,
  SetTaskCompletedInput,
  TaskDto,
  UpdateTaskTitleInput
} from '../../../../shared/contracts/tasks'
import { unwrapIpc } from '../../lib/ipc'

export const taskKeys = {
  all: ['tasks'] as const,
  list: () => [...taskKeys.all, 'list'] as const
}

export const taskMutationKeys = {
  create: [...taskKeys.all, 'create'] as const,
  updateTitle: [...taskKeys.all, 'update-title'] as const,
  setCompleted: [...taskKeys.all, 'set-completed'] as const
}

// タスク一覧の正本はこのQuery（全件）。一覧・詳細・件数はすべてここから導出する。
export const taskListQueryOptions = queryOptions({
  queryKey: taskKeys.list(),
  queryFn: () => unwrapIpc(window.gtd.tasks.list())
})

// 更新成功時に、保存後のDTOで一覧キャッシュの該当行だけを置き換える。
// 再取得しないので、一覧のスクロール位置や他の画面状態を初期化しない。
function replaceTaskInList(queryClient: QueryClient, saved: TaskDto): void {
  queryClient.setQueryData<TaskDto[]>(taskKeys.list(), (tasks) =>
    tasks?.map((task) => (task.id === saved.id ? saved : task))
  )
}

export function useCreateTaskMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.create,
    mutationFn: (input: CreateTaskInput) => unwrapIpc(window.gtd.tasks.create(input)),
    // 保存に成功した場合だけ、一覧をDBから取り直す。
    onSuccess: () => queryClient.invalidateQueries({ queryKey: taskKeys.list() })
  })
}

export function useUpdateTaskTitleMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.updateTitle,
    mutationFn: (input: UpdateTaskTitleInput) => unwrapIpc(window.gtd.tasks.updateTitle(input)),
    onSuccess: (saved) => replaceTaskInList(queryClient, saved)
  })
}

export function useSetTaskCompletedMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.setCompleted,
    mutationFn: (input: SetTaskCompletedInput) => unwrapIpc(window.gtd.tasks.setCompleted(input)),
    onSuccess: (saved) => replaceTaskInList(queryClient, saved)
  })
}

// 更新中（タイトル・完了状態）のタスクID。同じタスクへの重複更新を防ぐために使う。
export function usePendingTaskIds(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { status: 'pending', predicate: (mutation) => isTaskUpdateKey(mutation.options.mutationKey) },
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

function isTaskUpdateKey(key: readonly unknown[] | undefined): boolean {
  return (
    key !== undefined &&
    key[0] === taskKeys.all[0] &&
    (key[1] === taskMutationKeys.updateTitle[1] || key[1] === taskMutationKeys.setCompleted[1])
  )
}
