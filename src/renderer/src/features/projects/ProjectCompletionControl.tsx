import { useRef } from 'react'
import { Alert, Box, Button, Typography } from '@mui/material'
import { CircleCheck, ListTodo, RotateCcw } from 'lucide-react'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import { IpcCallError } from '../../lib/ipc'
import { useDraftGuard } from '../drafts/DraftGuard'
import { formatTaskDateTime } from '../tasks/TaskList'
import { usePendingProjectIds, useSetProjectCompletedMutation } from './project-queries'

// プロジェクトの完了・完了の取り消し（フェーズ5.3）。フェーズ5.5から右の詳細パネル（プロジェクトの詳細）に置く。
// - 状態は文字でも示す（「未完了」「完了済み（日時）」）。
// - 操作の前に、未保存の編集（プロジェクト名・タスクのタイトル）を既存の DraftGuard で確認する。
//   保存に成功した場合・破棄した場合だけ続行し、保存失敗・キャンセルなら何もしない。進行中の保存の完了も待つ。
// - 保存中は操作できない。表示は保存に成功した後だけ切り替える（楽観的更新はしない）。完了しても画面は移動しない。
// - 未完了のタスクがあって拒否された場合は、Mainが返した件数（型付きの details）と「未完了のタスクを表示」を示す。
export function ProjectCompletionControl({
  project,
  onRevealOpenTasks
}: {
  project: ProjectDto
  onRevealOpenTasks: () => void
}) {
  const setCompleted = useSetProjectCompletedMutation()
  const pendingProjectIds = usePendingProjectIds()
  const { confirmLeave } = useDraftGuard()
  // 確認ダイアログの表示中に重ねて押されても、要求は1回だけにする
  const confirmingRef = useRef(false)

  const completed = project.done
  const busy = pendingProjectIds.has(project.id)

  const toggle = async () => {
    if (busy || confirmingRef.current) return
    confirmingRef.current = true
    try {
      if (!(await confirmLeave())) return
    } finally {
      confirmingRef.current = false
    }
    setCompleted.reset()
    setCompleted.mutate({ id: project.id, completed: !completed })
  }

  const error = setCompleted.error
  const openTaskCount =
    error instanceof IpcCallError && error.details?.kind === 'project-has-open-tasks' ? error.details.openTaskCount : null

  return (
    <Box sx={{ mb: 3, flexShrink: 0 }} data-testid="project-completion">
      <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, mb: 0.5 }}>
        状態
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} data-testid="project-status">
          {completed ? `完了済み（${formatTaskDateTime(project.doneOn as string)}）` : '未完了'}
        </Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={busy}
          onClick={() => void toggle()}
          startIcon={completed ? <RotateCcw size={14} aria-hidden /> : <CircleCheck size={14} aria-hidden />}
          data-testid="project-completion-button"
        >
          {setCompleted.isPending ? '保存中…' : completed ? 'プロジェクトを未完了に戻す' : 'プロジェクトを完了'}
        </Button>
      </Box>
      {error && openTaskCount !== null && (
        <Alert
          severity="warning"
          variant="outlined"
          sx={{ mt: 2 }}
          data-testid="project-completion-error"
          onClose={() => setCompleted.reset()}
          action={
            <Button
              size="small"
              color="inherit"
              startIcon={<ListTodo size={14} aria-hidden />}
              onClick={onRevealOpenTasks}
              data-testid="reveal-open-tasks"
            >
              未完了のタスクを表示
            </Button>
          }
        >
          未完了のタスクが {openTaskCount} 件あるため完了できません。
        </Alert>
      )}
      {error && openTaskCount === null && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }} data-testid="project-completion-error" onClose={() => setCompleted.reset()}>
          {completed ? '未完了に戻せませんでした' : '完了できませんでした'}: {error.message}
        </Alert>
      )}
    </Box>
  )
}
