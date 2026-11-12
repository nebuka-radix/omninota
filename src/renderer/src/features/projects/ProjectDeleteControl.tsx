import { useRef, useState } from 'react'
import { Alert, Box, Button, Typography } from '@mui/material'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Trash2 } from 'lucide-react'
import type { MilestoneDto } from '../../../../shared/contracts/milestones'
import type { ProjectDeletionSummary, ProjectDto } from '../../../../shared/contracts/projects'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog'
import { IpcCallError } from '../../lib/ipc'
import { useDraftGuard, type DraftTarget } from '../drafts/DraftGuard'
import { milestoneKeys } from '../milestones/milestone-queries'
import { taskKeys } from '../tasks/task-queries'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { forgetNewProjectReturn } from './new-project'
import { fetchProjectDeletionSummary, usePendingProjectIds, useDeleteProjectMutation } from './project-queries'

const SCOPE_CHANGED_NOTICE = '確認した後にマイルストン・タスクの件数が変わりました。内容を確認して、もう一度削除してください。'

// プロジェクトの削除（フェーズ5.6）。右の詳細パネルのプロジェクトの詳細に置く。未完了・完了済みのどちらでも削除できる
// （完了の条件＝未完了タスクの有無とは無関係）。
// 1. 進行中の保存（保存キュー・編集欄）を待ち、DBで数えた件数（マイルストン数・既に非表示のものを含むタスク数）を取得する。
// 2. 名前・件数・「配下のマイルストン・タスクは残るが画面に表示されなくなる」ことを示して確認する。
// 3. 削除時は確認した件数を添える。件数が変わっていたら（Mainが拒否）、確認内容を取り直して再確認する。
// 4. 成功したら、このプロジェクト・配下の未保存の編集だけを破棄し、タスクの選択を解除して Inbox へ移る。
//    配下のタスクは非表示になるため Inbox にも表示されない。キャンセル・失敗では何も変えない（理由を表示する）。
export function ProjectDeleteControl({ project }: { project: ProjectDto }) {
  const { settle, hasDirty, discard } = useDraftGuard()
  const { selectTask } = useWorkspace()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const deleteProject = useDeleteProjectMutation()
  const pendingProjectIds = usePendingProjectIds()
  const [dialog, setDialog] = useState<{ summary: ProjectDeletionSummary; draftDirty: boolean; notice: string | null } | null>(null)
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const busyRef = useRef(false)

  // このプロジェクトと配下（画面のキャッシュ上のマイルストン・タスク）の編集
  const relatedMatch = () => {
    const milestoneIds = new Set(
      (queryClient.getQueryData<MilestoneDto[]>(milestoneKeys.list()) ?? []).filter((m) => m.projectId === project.id).map((m) => m.id)
    )
    const taskIds = new Set(
      (queryClient.getQueryData<TaskDto[]>(taskKeys.list()) ?? []).filter((t) => t.projectId === project.id).map((t) => t.id)
    )
    return (target: DraftTarget) =>
      (target.kind === 'project' && target.id === project.id) ||
      (target.kind === 'milestone' && milestoneIds.has(target.id)) ||
      (target.kind === 'task' && taskIds.has(target.id))
  }

  const openDialog = (summary: ProjectDeletionSummary, notice: string | null) => {
    deleteProject.reset()
    setDialog({ summary, draftDirty: hasDirty(relatedMatch()), notice })
  }

  const request = async () => {
    if (busyRef.current || dialog) return
    busyRef.current = true
    setPreparing(true)
    setPrepareError(null)
    try {
      await settle()
      openDialog(await fetchProjectDeletionSummary(project.id), null)
    } catch (error) {
      setPrepareError(`削除できませんでした: ${(error as Error).message}`)
    } finally {
      busyRef.current = false
      setPreparing(false)
    }
  }

  const confirm = async () => {
    if (!dialog || busyRef.current) return
    busyRef.current = true
    const { summary } = dialog
    const match = relatedMatch()
    try {
      await deleteProject.mutateAsync({
        id: summary.id,
        expectedMilestoneCount: summary.milestoneCount,
        expectedTaskCount: summary.taskCount
      })
      // 削除した対象の編集だけを破棄してから移動する（他の対象の未保存の編集は、移動時の既存の確認で扱う）
      discard(match)
      selectTask(null)
      forgetNewProjectReturn(summary.id)
      setDialog(null)
      void navigate({ to: '/inbox' })
    } catch (error) {
      if (error instanceof IpcCallError && error.details?.kind === 'deletion-scope-changed') {
        try {
          openDialog(await fetchProjectDeletionSummary(summary.id), SCOPE_CHANGED_NOTICE)
        } catch (fetchError) {
          setDialog(null)
          setPrepareError(`削除できませんでした: ${(fetchError as Error).message}`)
        }
      }
      // その他の失敗はダイアログに表示する（閉じない）
    } finally {
      busyRef.current = false
    }
  }

  const error = deleteProject.error
  const dialogError =
    error && !(error instanceof IpcCallError && error.details?.kind === 'deletion-scope-changed') ? `削除できませんでした: ${error.message}` : null
  const busy = preparing || pendingProjectIds.has(project.id)

  return (
    <Box sx={{ mb: 3 }} data-testid="project-delete">
      <Button
        size="small"
        color="error"
        variant="outlined"
        disabled={busy}
        onClick={() => void request()}
        startIcon={<Trash2 size={14} aria-hidden />}
        data-testid="project-delete-button"
      >
        {preparing ? '確認中…' : 'プロジェクトを削除'}
      </Button>
      {prepareError && (
        <Alert severity="error" variant="outlined" sx={{ mt: 2 }} onClose={() => setPrepareError(null)} data-testid="project-delete-error">
          {prepareError}
        </Alert>
      )}
      <ConfirmDeleteDialog
        open={dialog !== null}
        title="プロジェクトを削除しますか？"
        confirmLabel="プロジェクトを削除"
        pending={deleteProject.isPending}
        error={dialogError}
        notice={dialog?.notice ?? null}
        onConfirm={() => void confirm()}
        onCancel={() => {
          if (deleteProject.isPending) return
          setDialog(null)
          deleteProject.reset()
        }}
        testId="project-delete-dialog"
      >
        {dialog && (
          <>
            <Typography sx={{ fontSize: 13, fontWeight: 600, wordBreak: 'break-all' }} data-testid="project-delete-dialog-target">
              「{dialog.summary.name}」{dialog.summary.done ? '（完了済み）' : ''}
            </Typography>
            <Typography sx={{ fontSize: 13, mt: 1 }} data-testid="project-delete-dialog-count">
              マイルストン: {dialog.summary.milestoneCount} 件、タスク: {dialog.summary.taskCount} 件
              {dialog.summary.hiddenTaskCount > 0 ? `（うち既に表示されていないタスク ${dialog.summary.hiddenTaskCount} 件）` : ''}
            </Typography>
            <Typography sx={{ fontSize: 13, mt: 1 }}>
              配下のマイルストン・タスクは削除されずに残りますが、画面には表示されなくなります（Inbox にも表示しません）。
              プロジェクトは削除され、元に戻せません。
            </Typography>
            {dialog.draftDirty && (
              <Typography sx={{ fontSize: 13, mt: 1, color: 'warning.light' }} data-testid="project-delete-dialog-draft">
                このプロジェクト・配下の未保存の変更も失われます。
              </Typography>
            )}
          </>
        )}
      </ConfirmDeleteDialog>
    </Box>
  )
}
