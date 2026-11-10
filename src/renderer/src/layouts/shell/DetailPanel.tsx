import type { ReactNode, Ref } from 'react'
import { Box, Button, IconButton, Tooltip, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, X } from 'lucide-react'
import { useDraftGuard } from '../../features/drafts/DraftGuard'
import { NEW_PROJECT_PATH } from '../../features/projects/new-project'
import { ProjectCompletionControl } from '../../features/projects/ProjectCompletionControl'
import { ProjectDeleteControl } from '../../features/projects/ProjectDeleteControl'
import { projectListQueryOptions } from '../../features/projects/project-queries'
import { formatTaskDateTime } from '../../features/tasks/TaskList'
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
// プロジェクト画面では、タスク未選択ならプロジェクトの詳細、選択中ならタスクの詳細（と「プロジェクトの詳細」へ戻る操作）を表示する。
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

// プロジェクトの詳細（フェーズ5.5）。プロジェクト画面でタスクを選択していない時に表示する。
// 状態（未完了／完了済み）・完了・完了の取り消しは、メインパネルからここへ移した（メインパネルには重複して置かない）。
// フェーズ5.6: プロジェクトの削除もここに置く。
function ProjectDetail({ projectId }: { projectId: string }) {
  const projects = useQuery(projectListQueryOptions)
  const { requestRevealOpenTasks } = useWorkspace()
  if (projects.isPending) return <EmptyMessage>読み込み中…</EmptyMessage>
  if (projects.isError) return <EmptyMessage>プロジェクトを読み込めませんでした。</EmptyMessage>
  const project = projects.data.find((item) => item.id === projectId)
  if (!project) return <EmptyMessage>プロジェクトが見つかりません。</EmptyMessage>
  return (
    <Box component="section" aria-labelledby="project-detail-name" sx={{ px: 4, py: 3 }} data-testid="project-detail">
      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
        プロジェクト
      </Typography>
      <Typography id="project-detail-name" component="h2" sx={{ fontSize: 14, fontWeight: 600, m: 0, mb: 1, wordBreak: 'break-all' }} data-testid="project-detail-name">
        {project.name}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, mb: 3 }}>
        作成 {formatTaskDateTime(project.createdAt)}
      </Typography>
      <ProjectCompletionControl key={project.id} project={project} onRevealOpenTasks={requestRevealOpenTasks} />
      {/* 削除（フェーズ5.6）。完了の条件とは別の操作（未完了・完了済みのどちらでも削除できる） */}
      <ProjectDeleteControl key={`delete-${project.id}`} project={project} />
      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0 }}>
        タスクを選択すると、ここにタスクの詳細を表示します。
      </Typography>
    </Box>
  )
}

// タスクの詳細からプロジェクトの詳細へ戻る（タスクの選択を解除する）。未保存のタイトルは既存の確認を通す
function BackToProject({ taskId }: { taskId: string }) {
  const { selectTask } = useWorkspace()
  const { confirmLeave } = useDraftGuard()
  return (
    <Box sx={{ px: 2, pt: 2 }}>
      <Button
        size="small"
        startIcon={<ArrowLeft size={14} aria-hidden />}
        aria-label="プロジェクトの詳細へ戻る"
        data-testid="back-to-project"
        onClick={async () => {
          if (await confirmLeave({ target: { kind: 'task', id: taskId } })) selectTask(null)
        }}
        sx={{ fontSize: 12 }}
      >
        プロジェクトの詳細
      </Button>
    </Box>
  )
}

function DetailBody({ pathname }: { pathname: string }) {
  const { selectedTaskId } = useWorkspace()
  if (pathname === NEW_PROJECT_PATH) {
    // 新規プロジェクトは保存前なので、状態の表示・完了操作は出さない
    return <EmptyMessage>プロジェクト名を保存すると、ここにプロジェクトの状態を表示します。</EmptyMessage>
  }
  const scope = scopeOfPath(pathname)
  if (!scope) return <EmptyMessage>この画面に関連する詳細情報はありません。</EmptyMessage>
  if (scope.kind === 'project') {
    if (!selectedTaskId) return <ProjectDetail projectId={scope.projectId} />
    return (
      <>
        <BackToProject taskId={selectedTaskId} />
        <TaskDetail taskId={selectedTaskId} scope={scope} />
      </>
    )
  }
  return <TaskDetail taskId={selectedTaskId} scope={scope} />
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
        <DetailBody pathname={pathname} />
      </Box>
    </Box>
  )
}
