import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  CreateMilestoneInput,
  DeleteMilestoneInput,
  MilestoneDeletionSummary,
  MilestoneDto,
  RenameMilestoneInput,
  ReorderMilestonesInput
} from '../../../../shared/contracts/milestones'
import { unwrapIpc } from '../../lib/ipc'
import { taskKeys } from '../tasks/task-queries'
import { taskSaveQueue } from '../tasks/task-save-queue'

export const milestoneKeys = {
  all: ['milestones'] as const,
  list: () => [...milestoneKeys.all, 'list'] as const
}

export const milestoneMutationKeys = {
  create: [...milestoneKeys.all, 'create'] as const,
  rename: [...milestoneKeys.all, 'rename'] as const,
  delete: [...milestoneKeys.all, 'delete'] as const,
  reorder: [...milestoneKeys.all, 'reorder'] as const
}

// マイルストン一覧（全プロジェクト分・少量）。プロジェクト画面・Inboxの紐付け・詳細パネルで共通に使う（フェーズ5.4）。
export const milestoneListQueryOptions = queryOptions({
  queryKey: milestoneKeys.list(),
  queryFn: () => unwrapIpc(window.gtd.milestones.list())
})

export function useCreateMilestoneMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: milestoneMutationKeys.create,
    mutationFn: (input: CreateMilestoneInput) => unwrapIpc(window.gtd.milestones.create(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: milestoneKeys.list() })
  })
}

// 名前変更は同じマイルストンごとに順番に送り（保存キューのキー "milestone:<ID>"）、返却DTOで該当行だけを置き換える
export function useRenameMilestoneMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: milestoneMutationKeys.rename,
    mutationFn: (input: RenameMilestoneInput) =>
      taskSaveQueue.run(`milestone:${input.id}`, () => unwrapIpc(window.gtd.milestones.rename(input))),
    onSuccess: (saved: MilestoneDto) => {
      queryClient.setQueryData<MilestoneDto[]>(milestoneKeys.list(), (items) =>
        items?.map((item) => (item.id === saved.id ? saved : item))
      )
      if (queryClient.isFetching({ queryKey: milestoneKeys.list() }) > 0) {
        void queryClient.invalidateQueries({ queryKey: milestoneKeys.list() })
      }
    }
  })
}

// 削除の確認内容（フェーズ5.6）。件数はDBで数える（画面の絞り込み・表示件数では判定しない）。キャッシュしない
export function fetchMilestoneDeletionSummary(id: string): Promise<MilestoneDeletionSummary> {
  return unwrapIpc(window.gtd.milestones.getDeletionSummary({ id }))
}

// 削除（フェーズ5.6）。同じマイルストンの名前変更の後に実行する。成功したらマイルストン一覧とタスク一覧をDBから取り直す
// （所属タスクは非表示になり、一覧から消える）
export function useDeleteMilestoneMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: milestoneMutationKeys.delete,
    mutationFn: (input: DeleteMilestoneInput) =>
      taskSaveQueue.run(`milestone:${input.id}`, () => unwrapIpc(window.gtd.milestones.delete(input))),
    onSuccess: async (result) => {
      queryClient.setQueryData<MilestoneDto[]>(milestoneKeys.list(), (items) => items?.filter((item) => item.id !== result.id))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: milestoneKeys.list() }),
        queryClient.invalidateQueries({ queryKey: taskKeys.list() })
      ])
    }
  })
}

// カードの順序の保存（フェーズ5.9）。同じプロジェクトの並べ替えは順番に送る（キー "milestone-order:<プロジェクトID>"）。
// 成功した応答（全件・新しい順）でキャッシュを置き換える。失敗時は一覧を取り直す（画面は元の順のまま）
export function useReorderMilestonesMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: milestoneMutationKeys.reorder,
    mutationFn: (input: ReorderMilestonesInput) =>
      taskSaveQueue.run(`milestone-order:${input.projectId}`, () => unwrapIpc(window.gtd.milestones.reorder(input))),
    onSuccess: (saved: MilestoneDto[]) => {
      const byId = new Map(saved.map((item) => [item.id, item]))
      queryClient.setQueryData<MilestoneDto[]>(milestoneKeys.list(), (items) => items?.map((item) => byId.get(item.id) ?? item))
      if (queryClient.isFetching({ queryKey: milestoneKeys.list() }) > 0) {
        void queryClient.invalidateQueries({ queryKey: milestoneKeys.list() })
      }
    },
    onError: () => queryClient.invalidateQueries({ queryKey: milestoneKeys.list() })
  })
}
