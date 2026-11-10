import type { ReactNode, Ref } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { TaskEditor } from '../../features/tasks/TaskEditor'
import { taskListQueryOptions } from '../../features/tasks/task-queries'
import { INBOX_SCOPE, isTaskInScope, type TaskScope } from '../../features/tasks/task-scope'
import { projectIdFromRoute } from '../../../../shared/contracts/workspace'
import { useWorkspace } from '../../features/workspace/WorkspaceContext'
import { PaneHeader } from './PaneHeader'

function EmptyMessage({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ px: 4 }} role="status">
      {children}
    </Typography>
  )
}

// 選択中タスクの詳細。一覧と同じQuery（全件）のデータから探す（詳細取得APIや別の正本は持たない）。
// TaskEditorはタスクIDごとに作り直し、編集中のドラフトはそのタスクの間だけ保持する。
// 画面（ルート）に対応するタスク一覧の表示範囲。タスク一覧のない画面ではnull
function scopeOfPath(pathname: string): TaskScope | null {
  if (pathname === '/inbox') return INBOX_SCOPE
  const projectId = projectIdFromRoute(pathname)
  return projectId ? { kind: 'project', projectId } : null
}

function TaskDetail({ taskId, scope }: { taskId: string | null; scope: TaskScope }) {
  const task = useQuery({
    ...taskListQueryOptions,
    select: (tasks) => tasks.find((item) => item.id === taskId) ?? null
  })

  if (!taskId) return <EmptyMessage>タスクを選択すると、ここに詳細を表示します。</EmptyMessage>
  if (task.isPending) return <EmptyMessage>読み込み中…</EmptyMessage>
  if (task.isError) return <EmptyMessage>タスクを読み込めませんでした。</EmptyMessage>
  if (!task.data) return <EmptyMessage>選択したタスクが見つかりません。</EmptyMessage>
  return (
    <>
      {!isTaskInScope(task.data, scope) && (
        // 所属を変更して一覧から外れても、詳細とタイトルのドラフトはそのまま表示する
        <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 4, pt: 2, m: 0 }} role="status" data-testid="detail-out-of-scope">
          このタスクは現在の一覧の対象外です。
        </Typography>
      )}
      <TaskEditor key={task.data.id} task={task.data} />
    </>
  )
}

export function DetailPanel({
  pathname,
  onClose,
  containerRef
}: {
  pathname: string
  onClose: () => void
  containerRef: Ref<HTMLElement>
}) {
  const { selectedTaskId } = useWorkspace()
  const scope = scopeOfPath(pathname)

  return (
    <Box
      component="aside"
      id="detail-panel"
      ref={containerRef}
      aria-labelledby="detail-panel-title"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}
    >
      <PaneHeader
        id="detail-panel-title"
        title="詳細"
        actions={
          <Tooltip title="詳細パネルを閉じる">
            <IconButton aria-label="詳細パネルを閉じる" onClick={onClose} sx={{ color: 'text.secondary', borderRadius: 1 }}>
              <X size={16} strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        }
      />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {scope ? (
          <TaskDetail taskId={selectedTaskId} scope={scope} />
        ) : (
          <EmptyMessage>この画面に関連する詳細情報はありません。</EmptyMessage>
        )}
      </Box>
    </Box>
  )
}
