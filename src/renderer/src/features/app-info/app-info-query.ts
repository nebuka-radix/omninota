import { queryOptions } from '@tanstack/react-query'
import { unwrapIpc } from '../../lib/ipc'

export const appInfoQueryOptions = queryOptions({
  queryKey: ['app', 'info'],
  queryFn: () => unwrapIpc(window.gtd.app.getInfo()),
  // 起動中に変わらない情報なので再取得しない。
  staleTime: Infinity
})
