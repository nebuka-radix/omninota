import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CreateProjectInput, ProjectDto, RenameProjectInput } from '../../../../shared/contracts/projects'
import { unwrapIpc } from '../../lib/ipc'

export const projectKeys = {
  all: ['projects'] as const,
  list: () => [...projectKeys.all, 'list'] as const
}

export const projectMutationKeys = {
  create: [...projectKeys.all, 'create'] as const,
  rename: [...projectKeys.all, 'rename'] as const
}

// プロジェクト一覧（全件・少量）。個別の詳細Queryは作らず、この一覧から探す。
export const projectListQueryOptions = queryOptions({
  queryKey: projectKeys.list(),
  queryFn: () => unwrapIpc(window.gtd.projects.list())
})

export function useCreateProjectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: projectMutationKeys.create,
    mutationFn: (input: CreateProjectInput) => unwrapIpc(window.gtd.projects.create(input)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.list() })
  })
}

export function useRenameProjectMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: projectMutationKeys.rename,
    mutationFn: (input: RenameProjectInput) => unwrapIpc(window.gtd.projects.rename(input)),
    // 保存後のDTOで一覧の該当行だけを置き換える（再取得しない）
    onSuccess: (saved: ProjectDto) =>
      queryClient.setQueryData<ProjectDto[]>(projectKeys.list(), (projects) =>
        projects?.map((project) => (project.id === saved.id ? saved : project))
      )
  })
}
