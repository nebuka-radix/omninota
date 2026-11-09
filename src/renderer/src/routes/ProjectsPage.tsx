import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { FolderKanban } from 'lucide-react'
import { UUID_PATTERN } from '../../../shared/contracts/workspace'
import { Page } from '../components/Page'
import { ProjectNameEditor } from '../features/projects/ProjectNameEditor'
import { projectListQueryOptions } from '../features/projects/project-queries'

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
  const validId = UUID_PATTERN.test(projectId)

  let body
  if (!validId) {
    body = (
      <Alert severity="warning" variant="outlined">
        プロジェクトのIDが正しくありません。左の一覧から選択してください。
      </Alert>
    )
  } else if (projects.isPending) {
    body = (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }} role="status">
        <CircularProgress size={14} aria-hidden />
        <Typography variant="body2">読み込み中…</Typography>
      </Box>
    )
  } else if (projects.isError) {
    body = (
      <Alert severity="error" variant="outlined">
        プロジェクトを読み込めませんでした: {projects.error.message}
      </Alert>
    )
  } else {
    const project = projects.data.find((item) => item.id === projectId)
    body = project ? (
      <>
        <ProjectNameEditor key={project.id} project={project} />
        <Typography variant="body2" color="text.secondary" data-testid="project-scope-note">
          プロジェクトのタスク表示は次の段階（フェーズ5.2）で追加予定です。
        </Typography>
      </>
    ) : (
      <Alert severity="info" variant="outlined">
        指定したプロジェクトが見つかりません。左の一覧から選択してください。
      </Alert>
    )
  }

  return (
    <Page title="Projects" icon={FolderKanban}>
      {body}
    </Page>
  )
}
