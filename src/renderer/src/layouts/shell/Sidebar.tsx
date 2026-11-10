import { Box, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { taskListQueryOptions } from '../../features/tasks/task-queries'
import { INBOX_SCOPE, isTaskInScope } from '../../features/tasks/task-scope'
import { PaneHeader } from './PaneHeader'
import { ProjectsSidebar } from '../../features/projects/ProjectsSidebar'
import { SCREENS, screenOf } from './screens'

function InboxSummary() {
  // Inboxの一覧と同じQueryを使う（追加の取得APIは使わない）。Inboxはプロジェクトに属さないタスク（フェーズ5.2）
  const tasks = useQuery(taskListQueryOptions)
  let text: string
  if (tasks.isPending) text = '件数を読み込み中…'
  else if (tasks.isError) text = '件数を取得できませんでした'
  else {
    const inbox = tasks.data.filter((task) => isTaskInScope(task, INBOX_SCOPE))
    const open = inbox.filter((task) => task.completedAt === null).length
    text = `未完了 ${open} 件 / 全 ${inbox.length} 件`
  }
  return (
    <Typography variant="body2" color="text.secondary" sx={{ px: 4 }}>
      {text}
    </Typography>
  )
}

// 現在の画面に対応した見出しと最小限の内容を表示する。
export function Sidebar({ pathname }: { pathname: string }) {
  const screen = screenOf(pathname)
  const title = screen ? SCREENS[screen].label : '画面'

  return (
    <Box
      component="aside"
      aria-labelledby="sidebar-title"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}
    >
      <PaneHeader id="sidebar-title" title={title} />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {screen === 'inbox' && <InboxSummary />}
        {screen === 'projects' && <ProjectsSidebar pathname={pathname} />}
        {pathname === '/settings' && (
          <Typography variant="body2" color="text.secondary" sx={{ px: 4 }}>
            アプリ情報
          </Typography>
        )}
      </Box>
    </Box>
  )
}
