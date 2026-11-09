import { Box, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { taskListQueryOptions } from '../../features/tasks/task-queries'
import { isWorkspaceRoute } from '../../../../shared/contracts/workspace'
import { PaneHeader } from './PaneHeader'
import { SCREENS } from './screens'

function InboxSummary() {
  // Inboxの一覧と同じQueryを使う（追加の取得APIは使わない）
  const tasks = useQuery(taskListQueryOptions)
  let text: string
  if (tasks.isPending) text = '件数を読み込み中…'
  else if (tasks.isError) text = '件数を取得できませんでした'
  else {
    const open = tasks.data.filter((task) => task.completedAt === null).length
    text = `未完了 ${open} 件 / 全 ${tasks.data.length} 件`
  }
  return (
    <Typography variant="body2" color="text.secondary" sx={{ px: 4 }}>
      {text}
    </Typography>
  )
}

// 現在の画面に対応した見出しと最小限の内容を表示する。
export function Sidebar({ pathname }: { pathname: string }) {
  const title = isWorkspaceRoute(pathname) ? SCREENS[pathname].label : '画面'

  return (
    <Box
      component="aside"
      aria-labelledby="sidebar-title"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}
    >
      <PaneHeader id="sidebar-title" title={title} />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {pathname === '/inbox' && <InboxSummary />}
        {pathname === '/settings' && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 4 }}>
            アプリ情報
          </Typography>
        )}
      </Box>
    </Box>
  )
}
