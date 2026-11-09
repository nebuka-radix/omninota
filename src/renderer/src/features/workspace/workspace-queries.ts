import { queryOptions } from '@tanstack/react-query'
import { unwrapIpc } from '../../lib/ipc'

// 起動時に1回だけ読み込むスナップショット。以後の正本はWorkspaceContextのstate。
export const workspaceSettingsQueryOptions = queryOptions({
  queryKey: ['workspace', 'settings'],
  queryFn: () => unwrapIpc(window.gtd.workspace.get()),
  staleTime: Infinity,
  gcTime: Infinity
})
