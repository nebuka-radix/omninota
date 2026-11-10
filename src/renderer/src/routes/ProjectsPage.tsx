import { useState } from 'react'
import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'
import { FolderKanban, Plus } from 'lucide-react'
import { INITIAL_MILESTONE_NAME } from '../../../shared/contracts/milestones'
import { Page } from '../components/Page'
import { ProjectNameEditor } from '../features/projects/ProjectNameEditor'
import { projectListQueryOptions } from '../features/projects/project-queries'
import { getProjectPageState } from '../features/projects/project-route'
import { TaskScopeView } from '../features/tasks/TaskScopeView'
import { initialStatusForProject } from '../features/tasks/task-rules'
import { DEFAULT_TASK_SORTING } from '../features/tasks/task-table'
import { useWorkspace } from '../features/workspace/WorkspaceContext'
import { vscodeColors } from '../theme'

// /projects: 未選択
export function ProjectsIndexPage() {
  return (
    <Page title="Project" icon={FolderKanban} titleHidden>
      <Typography variant="body2" color="text.secondary">
        左のサイドバーからプロジェクトを選択するか、「NEW PROJECT」で新しいプロジェクトを作成してください。
      </Typography>
    </Page>
  )
}

// /projects/new: 新規プロジェクトの編集画面（フェーズ5.5）。既存プロジェクトの画面と同じ名前の編集部品を使う。
// 名前を保存するまではDBにプロジェクトを作らない。マイルストン・タスクの追加は、名前を保存するまで無効にする。
// フェーズ5.6: 名前を保存すると、プロジェクトと「新しいマイルストン」を1つのトランザクションで作る（保存後のカードの位置に予告として示す）。
export function NewProjectPage() {
  return (
    <Page title="Project" icon={FolderKanban} fill titleHidden>
      <Box sx={{ flexShrink: 0 }}>
        <ProjectNameEditor project={null} />
      </Box>
      <Typography variant="body2" color="text.secondary" role="note" sx={{ mb: 2, flexShrink: 0 }} data-testid="new-project-note">
        マイルストン・タスクを追加するには、先にプロジェクト名を保存してください。保存すると「{INITIAL_MILESTONE_NAME}」も作成されます。
      </Typography>
      {/* 保存後に表示されるカードの位置に、無効な操作を示す（押してもDBは変更しない） */}
      <Box sx={{ display: 'flex', gap: 3, minHeight: 0, flex: 1, overflow: 'hidden' }}>
        <Box
          component="section"
          aria-label={`${INITIAL_MILESTONE_NAME}（保存時に作成）`}
          sx={{
            width: 320,
            flex: '0 0 auto',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: vscodeColors.sideBarBackground,
            border: `1px solid ${vscodeColors.border}`,
            borderRadius: 1
          }}
        >
          <Typography component="h2" sx={{ fontSize: 13, fontWeight: 600, m: 0, px: 2, py: 1.5, color: 'text.secondary', borderBottom: `1px solid ${vscodeColors.border}` }}>
            {INITIAL_MILESTONE_NAME}（保存時に作成）
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ px: 1, py: 1, borderTop: `1px solid ${vscodeColors.border}` }}>
            <Button size="small" fullWidth disabled startIcon={<Plus size={14} aria-hidden />} sx={{ justifyContent: 'flex-start', fontSize: 12, fontWeight: 600 }} data-testid="new-task-placeholder-button">
              NEW TASK
            </Button>
          </Box>
        </Box>
        <Box sx={{ width: 220, flex: '0 0 auto', pt: 0.5 }}>
          <Button size="small" fullWidth disabled startIcon={<Plus size={14} aria-hidden />} sx={{ justifyContent: 'flex-start', fontSize: 12, fontWeight: 600 }} data-testid="new-milestone-button">
            NEW MILESTONE
          </Button>
        </Box>
      </Box>
    </Page>
  )
}

// /projects/$projectId: 選択中のプロジェクトと、そのプロジェクトに属するタスク（フェーズ5.2）。
// 取得中・取得失敗・存在しない・IDの形式が不正、を区別して表示する（取得失敗を「見つかりません」と表示しない）。
// プロジェクトの切り替えはルートの変更（未保存の確認の後）。切り替えると検索はリセット、
// 状態は「未完了のプロジェクトなら未完了、完了済みなら完了」（フェーズ5.3）、タスクの選択は解除し、ソートは維持する
// （このコンポーネントは切り替えても作り直されないため、ソートをここで持つ）。
// 同じ画面のまま完了・取り消しをしても、状態フィルターは変えない（一覧が突然空になる・入れ替わることを避ける）。
// フェーズ5.5: 状態の表示・完了・完了の取り消しは右の詳細パネルへ移した（ここには置かない）。
// 「未完了のタスクを表示」の要求は詳細パネルから WorkspaceContext を通して届く。
export function ProjectPage({ projectId }: { projectId: string }) {
  const projects = useQuery(projectListQueryOptions)
  const state = getProjectPageState(projectId, projects)
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_TASK_SORTING)
  // 「未完了のタスクを表示」の要求回数（TaskScopeView は表示した後に増えた時だけ反応する）
  const { revealOpenRequest } = useWorkspace()

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
          <TaskScopeView
            key={state.project.id}
            scope={{ kind: 'project', projectId: state.project.id }}
            scopeLabel={`プロジェクト「${state.project.name}」`}
            sorting={sorting}
            onSortingChange={setSorting}
            initialStatus={initialStatusForProject(state.project)}
            revealOpenRequest={revealOpenRequest}
            project={state.project}
          />
        </>
      )
      break
  }

  return (
    // フェーズ5.7: 画面種別の「Project」の行は表示しない（個別のプロジェクト名と編集は残す。見出しは読み上げ用に残す）
    <Page title="Project" icon={FolderKanban} fill={state.kind === 'found'} titleHidden>
      {body}
    </Page>
  )
}
