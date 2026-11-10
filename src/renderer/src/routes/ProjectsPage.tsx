import { useState } from 'react'
import { Alert, Box, CircularProgress, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'
import { FolderKanban } from 'lucide-react'
import { Page } from '../components/Page'
import { ProjectNameEditor } from '../features/projects/ProjectNameEditor'
import { projectListQueryOptions } from '../features/projects/project-queries'
import { getProjectPageState } from '../features/projects/project-route'
import { TaskScopeView } from '../features/tasks/TaskScopeView'
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
// プロジェクトの切り替えはルートの変更（未保存の確認の後）。切り替えると検索はリセット、状態は未完了、
// タスクの選択は解除し、ソートは維持する（このコンポーネントは切り替えても作り直されないため、ソートをここで持つ）。
export function ProjectPage({ projectId }: { projectId: string }) {
  const projects = useQuery(projectListQueryOptions)
  const state = getProjectPageState(projectId, projects)
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_TASK_SORTING)

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
            addTargetLabel={`「${state.project.name}」に追加`}
            addDisabledReason={
              state.project.completedAt !== null
                ? `「${state.project.name}」は完了済みのため、タスクを追加できません。`
                : undefined
            }
            sorting={sorting}
            onSortingChange={setSorting}
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
