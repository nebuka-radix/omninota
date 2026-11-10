import { queryOptions, useMutation, useMutationState, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  CreateTaskInput,
  DeleteTaskInput,
  SetTaskAssignmentInput,
  SetTaskCompletedInput,
  TaskDto,
  UpdateTaskTitleInput
} from '../../../../shared/contracts/tasks'
import { unwrapIpc } from '../../lib/ipc'
import { taskSaveQueue } from './task-save-queue'

export const taskKeys = {
  all: ['tasks'] as const,
  list: () => [...taskKeys.all, 'list'] as const
}

export const taskMutationKeys = {
  create: [...taskKeys.all, 'create'] as const,
  updateTitle: [...taskKeys.all, 'update-title'] as const,
  setCompleted: [...taskKeys.all, 'set-completed'] as const,
  setAssignment: [...taskKeys.all, 'set-assignment'] as const,
  delete: [...taskKeys.all, 'delete'] as const
}

// タスク一覧の正本はこのQuery（全件）。Inbox・プロジェクトの一覧、詳細、件数はすべてここから導出する。
// 表示範囲（所属）はTableの絞り込みで決め、範囲ごとのQueryは作らない（フェーズ5.2）。
export const taskListQueryOptions = queryOptions({
  queryKey: taskKeys.list(),
  queryFn: () => unwrapIpc(window.gtd.tasks.list())
})

// 更新成功時に、保存後のDTOで一覧キャッシュの該当行だけを置き換える。
// 再取得しないので、一覧のスクロール位置や他の画面状態を初期化しない。他のタスク・プロジェクトのキャッシュは変えない。
// 一覧の再取得が進行中なら（更新前の状態を返す可能性があるため）、その結果で上書きされないよう取り直す。
function replaceTaskInList(queryClient: QueryClient, saved: TaskDto): void {
  queryClient.setQueryData<TaskDto[]>(taskKeys.list(), (tasks) =>
    tasks?.map((task) => (task.id === saved.id ? saved : task))
  )
  if (queryClient.isFetching({ queryKey: taskKeys.list() }) > 0) {
    void queryClient.invalidateQueries({ queryKey: taskKeys.list() })
  }
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

// 既存タスクの更新は、同じタスクについて順番に1つずつ実行する（task-save-queue.ts）。
// 各応答は保存後のタスク全体なので、最後に届いた応答が最新の状態になる（古いDTOで別の項目を上書きしない）。
export function useUpdateTaskTitleMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.updateTitle,
    mutationFn: (input: UpdateTaskTitleInput) =>
      taskSaveQueue.run(input.id, () => unwrapIpc(window.gtd.tasks.updateTitle(input))),
    onSuccess: (saved) => replaceTaskInList(queryClient, saved)
  })
}

export function useSetTaskCompletedMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.setCompleted,
    mutationFn: (input: SetTaskCompletedInput) =>
      taskSaveQueue.run(input.id, () => unwrapIpc(window.gtd.tasks.setCompleted(input))),
    onSuccess: (saved) => replaceTaskInList(queryClient, saved)
  })
}

// 所属（プロジェクト・マイルストン）の変更・解除（フェーズ5.4）。最終的な所属先を1回で保存する。
export function useSetTaskAssignmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.setAssignment,
    mutationFn: (input: SetTaskAssignmentInput) =>
      taskSaveQueue.run(input.id, () => unwrapIpc(window.gtd.tasks.setAssignment(input))),
    onSuccess: (saved) => replaceTaskInList(queryClient, saved)
  })
}

// タスクの削除（フェーズ5.6）。同じタスクの保存キューに並べ、先に始めた更新の後に実行する
// （削除した後に、遅れた更新が届いて対象を作り直すことはない。Mainは非表示・削除済みへの更新を NOT_FOUND にする）。
// 成功したら一覧キャッシュからその行だけを除き、DBから取り直す。失敗時はキャッシュを変えない（行を残す）。
export function useDeleteTaskMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.delete,
    mutationFn: (input: DeleteTaskInput) => taskSaveQueue.run(input.id, () => unwrapIpc(window.gtd.tasks.delete(input))),
    onSuccess: (result) => {
      queryClient.setQueryData<TaskDto[]>(taskKeys.list(), (tasks) => tasks?.filter((task) => task.id !== result.id))
      void queryClient.invalidateQueries({ queryKey: taskKeys.list() })
    }
  })
}

// 更新中（タイトル・完了状態・所属・削除）のタスクID。同じタスクへの重複操作を制限するために使う。
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

const TASK_UPDATE_KEYS: readonly unknown[] = [
  taskMutationKeys.updateTitle[1],
  taskMutationKeys.setCompleted[1],
  taskMutationKeys.setAssignment[1],
  taskMutationKeys.delete[1]
]

function isTaskUpdateKey(key: readonly unknown[] | undefined): boolean {
  return key !== undefined && key[0] === taskKeys.all[0] && TASK_UPDATE_KEYS.includes(key[1])
}
