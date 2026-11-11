import { useCallback, useSyncExternalStore } from 'react'
import { queryOptions, useMutation, useMutationState, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type {
  AssignInboxTasksInput,
  CreateTaskInput,
  DeleteTaskInput,
  DeleteTasksInput,
  ReorderMilestoneTasksInput,
  SetTaskDueInput,
  SetTaskAssignmentInput,
  SetTaskCompletedInput,
  TaskDto,
  UpdateTaskTitleInput
} from '../../../../shared/contracts/tasks'
import { unwrapIpc } from '../../lib/ipc'
import { queryClient as appQueryClient } from '../../lib/query-client'
import { createFavoriteSaver } from './favorite-saver'
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
  delete: [...taskKeys.all, 'delete'] as const,
  // フェーズ5.9: 一括操作・並べ替え（variables は ids / orderedIds を持つ）
  assignFromInbox: [...taskKeys.all, 'assign-from-inbox'] as const,
  deleteMany: [...taskKeys.all, 'delete-many'] as const,
  reorder: [...taskKeys.all, 'reorder'] as const,
  // フェーズ6: 期限
  setDue: [...taskKeys.all, 'set-due'] as const
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

// 一括操作の保存後に、返されたタスクで一覧キャッシュの該当行を置き換える（他の行・スクロール位置は変えない）
function replaceTasksInList(queryClient: QueryClient, saved: readonly TaskDto[]): void {
  const byId = new Map(saved.map((task) => [task.id, task]))
  queryClient.setQueryData<TaskDto[]>(taskKeys.list(), (tasks) => tasks?.map((task) => byId.get(task.id) ?? task))
  if (queryClient.isFetching({ queryKey: taskKeys.list() }) > 0) {
    void queryClient.invalidateQueries({ queryKey: taskKeys.list() })
  }
}

// Inboxの複数タスクを1つのマイルストンへ一括で紐付ける（フェーズ5.9）。Main が1つのトランザクションで全件を検証・更新する。
// 対象タスクの進行中の更新（タイトルなど）が終わってから送る。成功した時だけキャッシュを更新する（Inboxから消える）。
// 失敗時はキャッシュを変えない（行・選択を残し、理由を表示する）。
export function useAssignInboxTasksMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.assignFromInbox,
    mutationFn: (input: AssignInboxTasksInput) =>
      taskSaveQueue.runMany(input.ids, () => unwrapIpc(window.gtd.tasks.assignFromInbox(input))),
    onSuccess: (saved) => replaceTasksInList(queryClient, saved)
  })
}

// 表示中の複数タスクの物理削除（フェーズ5.9。確認ダイアログなし）。対象の進行中の更新の後に実行する。
// 成功したら一覧キャッシュから除き、DBから取り直す。失敗時はキャッシュを変えない
export function useDeleteTasksMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.deleteMany,
    mutationFn: (input: DeleteTasksInput) => taskSaveQueue.runMany(input.ids, () => unwrapIpc(window.gtd.tasks.deleteMany(input))),
    onSuccess: (result) => {
      const removed = new Set(result.ids)
      queryClient.setQueryData<TaskDto[]>(taskKeys.list(), (tasks) => tasks?.filter((task) => !removed.has(task.id)))
      void queryClient.invalidateQueries({ queryKey: taskKeys.list() })
    }
  })
}

// マイルストン内のタスクの手動順の保存（フェーズ5.9）。画面の順序は保存に成功した応答で切り替える
// （先に画面だけを並べ替えない。失敗時は元の順のまま理由を表示する）。順序が古い（CONFLICT）場合は一覧を取り直す
export function useReorderMilestoneTasksMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.reorder,
    mutationFn: (input: ReorderMilestoneTasksInput) =>
      taskSaveQueue.runMany(input.orderedIds, () => unwrapIpc(window.gtd.tasks.reorderInMilestone(input))),
    onSuccess: (saved) => replaceTasksInList(queryClient, saved),
    onError: () => queryClient.invalidateQueries({ queryKey: taskKeys.list() })
  })
}

// 期限の設定・変更・解除（フェーズ6）。同じタスクの保存キューに並べる（タイトルの保存・所属の変更・削除と順番に実行する。
// 削除の後に届いても Main が NOT_FOUND にし、対象を作り直さない）。成功した応答だけで一覧の行を置き換える。
// Summary Review の取得結果は query-client の MutationCache で古いものとして扱う
export function useSetTaskDueMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: taskMutationKeys.setDue,
    mutationFn: (input: SetTaskDueInput) => taskSaveQueue.run(input.id, () => unwrapIpc(window.gtd.tasks.setDue(input))),
    onSuccess: (saved) => replaceTaskInList(queryClient, saved)
  })
}

// 更新中（タイトル・完了状態・所属・削除・一括操作）のタスクID。同じタスクへの重複操作を制限するために使う。
export function usePendingTaskIds(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { status: 'pending', predicate: (mutation) => isTaskUpdateKey(mutation.options.mutationKey) },
    select: (mutation) => variableTaskIds(mutation.state.variables)
  })
  const set = new Set<string>()
  for (const list of ids) for (const id of list) set.add(id)
  return set
}

// 更新の入力に含まれるタスクID（単体は id、一括は ids、並べ替えは orderedIds）
function variableTaskIds(variables: unknown): string[] {
  if (typeof variables !== 'object' || variables === null) return []
  const record = variables as Record<string, unknown>
  if (typeof record['id'] === 'string') return [record['id']]
  const list = record['ids'] ?? record['orderedIds']
  return Array.isArray(list) ? list.filter((value): value is string => typeof value === 'string') : []
}

const TASK_UPDATE_KEYS: readonly unknown[] = [
  taskMutationKeys.updateTitle[1],
  taskMutationKeys.setCompleted[1],
  taskMutationKeys.setAssignment[1],
  taskMutationKeys.delete[1],
  taskMutationKeys.assignFromInbox[1],
  taskMutationKeys.deleteMany[1],
  taskMutationKeys.reorder[1],
  taskMutationKeys.setDue[1]
]

function isTaskUpdateKey(key: readonly unknown[] | undefined): boolean {
  return key !== undefined && key[0] === taskKeys.all[0] && TASK_UPDATE_KEYS.includes(key[1])
}

// --- お気に入り（TaskRow の星） ---
// 順序制御は favorite-saver.ts（同じタスクの保存キュー・最後に押した状態を保存）。アプリ全体で1つ。
// 保存中は行を「保存中」にしない（連打しても行を薄くしない・他の操作を止めない）。順番は保存キューが保証する。
let favoriteError: string | null = null
const favoriteErrorListeners = new Set<() => void>()
const setFavoriteError = (message: string | null) => {
  favoriteError = message
  for (const listener of favoriteErrorListeners) listener()
}

export const taskFavoriteSaver = createFavoriteSaver<TaskDto>({
  enqueue: (taskId, save) => taskSaveQueue.run(taskId, save),
  save: (id, favorite) => unwrapIpc(window.gtd.tasks.setFavorite({ id, favorite })),
  onSaved: (saved) => replaceTaskInList(appQueryClient, saved),
  onError: (_taskId, error) => {
    setFavoriteError(`お気に入りを保存できませんでした: ${(error as Error).message}`)
    // 表示を保存済みの値と揃える（一覧を DB から取り直す）
    void appQueryClient.invalidateQueries({ queryKey: taskKeys.list() })
    void appQueryClient.invalidateQueries({ queryKey: ['summary'] })
  }
})

export function useTaskFavorite() {
  // 目的の状態・エラーが変わったら再描画する
  useSyncExternalStore(taskFavoriteSaver.subscribe, () => taskFavoriteSaver.version())
  const error = useSyncExternalStore(
    (listener) => {
      favoriteErrorListeners.add(listener)
      return () => favoriteErrorListeners.delete(listener)
    },
    () => favoriteError
  )
  const isFavorite = useCallback((task: TaskDto) => taskFavoriteSaver.desired(task.id) ?? task.favorite, [])
  const toggle = useCallback((task: TaskDto) => {
    setFavoriteError(null)
    taskFavoriteSaver.toggle(task.id, task.favorite)
  }, [])
  return { isFavorite, toggle, error, clearError: () => setFavoriteError(null) }
}

