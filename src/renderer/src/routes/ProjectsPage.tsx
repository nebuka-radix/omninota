import { useState } from 'react'
import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'
import { FolderKanban } from 'lucide-react'
import { Page } from '../components/Page'
import { useDraftGuard } from '../features/drafts/DraftGuard'
import { MilestoneCreateForm, MilestoneNameEditor } from '../features/milestones/MilestoneForms'
import { milestoneListQueryOptions } from '../features/milestones/milestone-queries'
import { ProjectCompletionControl } from '../features/projects/ProjectCompletionControl'
import { ProjectNameEditor } from '../features/projects/ProjectNameEditor'
import { projectListQueryOptions } from '../features/projects/project-queries'
import { getProjectPageState } from '../features/projects/project-route'
import { TaskScopeView } from '../features/tasks/TaskScopeView'
import { initialStatusForProject } from '../features/tasks/task-rules'
import { DEFAULT_TASK_SORTING } from '../features/tasks/task-table'

// /projects: 未選択
export function ProjectsIndexPage() {
  return (
    <Page title="Projects" icon={FolderKanban}>
      <Typography variant="body2" color="text.secondary">
        左のサイドバーからプロジェクトを選択するか、新しいプロジェクトを作成してください。
      </Typography>
    </Page>
  )
}

// /projects/$projectId: 選択中のプロジェクトと、そのプロジェクトに属するタスク（フェーズ5.2）。
// 取得中・取得失敗・存在しない・IDの形式が不正、を区別して表示する（取得失敗を「見つかりません」と表示しない）。
// プロジェクトの切り替えはルートの変更（未保存の確認の後）。切り替えると検索はリセット、
// 状態は「未完了のプロジェクトなら未完了、完了済みなら完了」（フェーズ5.3）、タスクの選択は解除し、ソートは維持する
// （このコンポーネントは切り替えても作り直されないため、ソートをここで持つ）。
// 同じ画面のまま完了・取り消しをしても、状態フィルターは変えない（一覧が突然空になる・入れ替わることを避ける）。
export function ProjectPage({ projectId }: { projectId: string }) {
  const projects = useQuery(projectListQueryOptions)
  const state = getProjectPageState(projectId, projects)
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_TASK_SORTING)
  // 「未完了のタスクを表示」の要求回数（TaskScopeView が増えた時だけ反応する）
  const [revealOpenRequest, setRevealOpenRequest] = useState(0)
  // 名前を編集中のマイルストン（一覧の見出しの「名前変更」で開く。フェーズ5.4）
  const [editingMilestoneId, setEditingMilestoneId] = useState<string | null>(null)
  const milestones = useQuery(milestoneListQueryOptions)
  const { confirmLeave } = useDraftGuard()
  // 表示中のプロジェクトのマイルストンだけを編集対象にする（プロジェクトを切り替えたら閉じる）
  const editingMilestone = milestones.data?.find((item) => item.id === editingMilestoneId && item.projectId === projectId)
  const openMilestoneEditor = async (milestoneId: string) => {
    if (milestoneId === editingMilestoneId) return
    // 別の編集（マイルストン名・プロジェクト名・タスクのタイトル）が未保存なら、先に既存の確認を行う
    if (!(await confirmLeave())) return
    setEditingMilestoneId(milestoneId)
  }

  let body
  switch (state.kind) {
    case 'invalid-id':
      body = (
        <Alert severity="warning" variant="outlined">
          プロジェクトのIDが正しくありません。左の一覧から選択してください。
        </Alert>
      )
      break
    case 'loading':
      body = (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }} role="status">
          <CircularProgress size={14} aria-hidden />
          <Typography variant="body2">読み込み中…</Typography>
        </Box>
      )
      break
    case 'error':
      body = (
        <Alert severity="error" variant="outlined">
          プロジェクトを読み込めませんでした: {state.message}
        </Alert>
      )
      break
    case 'not-found':
      body = (
        <Alert severity="info" variant="outlined">
          指定したプロジェクトが見つかりません。左の一覧から選択してください。
        </Alert>
      )
      break
    case 'found':
      body = (
        <>
          <Box sx={{ flexShrink: 0 }}>
            <ProjectNameEditor key={state.project.id} project={state.project} />
          </Box>
          <ProjectCompletionControl
            key={`completion-${state.project.id}`}
            project={state.project}
            onRevealOpenTasks={() => setRevealOpenRequest((count) => count + 1)}
          />
          <MilestoneCreateForm
            key={`milestone-create-${state.project.id}`}
            projectId={state.project.id}
            disabledReason={
              state.project.completedAt !== null ? '完了済みのプロジェクトにはマイルストンを追加できません' : undefined
            }
          />
          {editingMilestone && (
            <MilestoneNameEditor
              key={editingMilestone.id}
              milestone={editingMilestone}
              onClose={() => setEditingMilestoneId(null)}
            />
          )}
          <TaskScopeView
            key={state.project.id}
            scope={{ kind: 'project', projectId: state.project.id }}
            scopeLabel={`プロジェクト「${state.project.name}」`}
            addTargetLabel={`「${state.project.name}」に追加`}
            addDisabledReason={
              state.project.completedAt !== null
                ? `「${state.project.name}」は完了済みのため、タスクを追加できません。`
                : undefined
            }
            sorting={sorting}
            onSortingChange={setSorting}
            initialStatus={initialStatusForProject(state.project)}
            revealOpenRequest={revealOpenRequest}
            project={state.project}
            onRenameMilestone={(milestoneId) => void openMilestoneEditor(milestoneId)}
          />
        </>
      )
      break
  }

  return (
    <Page title="Projects" icon={FolderKanban} fill={state.kind === 'found'}>
      {body}
    </Page>
  )
}
