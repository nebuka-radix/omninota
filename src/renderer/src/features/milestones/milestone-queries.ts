import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateMilestoneInput, MilestoneDto, RenameMilestoneInput } from '../../../../shared/contracts/milestones'
import { unwrapIpc } from '../../lib/ipc'
import { taskSaveQueue } from '../tasks/task-save-queue'

export const milestoneKeys = {
  all: ['milestones'] as const,
  list: () => [...milestoneKeys.all, 'list'] as const
}

export const milestoneMutationKeys = {
  create: [...milestoneKeys.all, 'create'] as const,
  rename: [...milestoneKeys.all, 'rename'] as const
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
