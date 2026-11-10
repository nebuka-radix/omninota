import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { FolderKanban } from 'lucide-react'
import { Page } from '../components/Page'
import { ProjectNameEditor } from '../features/projects/ProjectNameEditor'
import { projectListQueryOptions } from '../features/projects/project-queries'
import { getProjectPageState } from '../features/projects/project-route'

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

// /projects/$projectId: 選択中のプロジェクト。
// 取得中・取得失敗・存在しない・IDの形式が不正、を区別して表示する（取得失敗を「見つかりません」と表示しない）。
export function ProjectPage({ projectId }: { projectId: string }) {
  const projects = useQuery(projectListQueryOptions)
  const state = getProjectPageState(projectId, projects)

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
          <ProjectNameEditor key={state.project.id} project={state.project} />
          <Typography variant="body2" color="text.secondary" data-testid="project-scope-note">
            プロジェクトのタスク表示は次の段階（フェーズ5.2）で追加予定です。
          </Typography>
        </>
      )
      break
  }

  return (
    <Page title="Projects" icon={FolderKanban}>
      {body}
    </Page>
  )
}
