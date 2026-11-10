import {
  Alert,
  Box,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Typography
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import { projectIdFromRoute } from '../../../../shared/contracts/workspace'
import { formatTaskDateTime } from '../tasks/TaskList'
import { NEW_PROJECT_PATH, rememberNewProjectReturn } from './new-project'
import { groupProjects } from './project-order'
import { projectListQueryOptions } from './project-queries'

// Projectの左サイドバー: プロジェクト一覧（未完了・完了済みの区分）と、最下段の「NEW PROJECT」（フェーズ5.5）。
// - 旧来の名前入力欄と＋ボタンは廃止した。NEW PROJECT はメインパネルに新規プロジェクトの編集画面を開く（DBにはまだ作らない）。
// - プロジェクトの選択・NEW PROJECT はルートの変更（未保存の編集があれば、遷移の前に既存の確認が出る）。
function NewProjectItem({ pathname }: { pathname: string }) {
  const navigate = useNavigate()
  const current = pathname === NEW_PROJECT_PATH
  return (
    <ListItemButton
      selected={current}
      aria-current={current ? 'page' : undefined}
      data-testid="new-project"
      onClick={() => {
        if (current) return
        rememberNewProjectReturn(pathname)
        void navigate({ to: NEW_PROJECT_PATH })
      }}
      sx={{ px: 4, gap: 1.5, mt: 1 }}
    >
      <Plus size={14} aria-hidden />
      <ListItemText
        primary="NEW PROJECT"
        slotProps={{ primary: { noWrap: true, sx: { fontSize: 12, fontWeight: 600, letterSpacing: 0.4 } } }}
      />
    </ListItemButton>
  )
}

export function ProjectsSidebar({ pathname }: { pathname: string }) {
  const projects = useQuery(projectListQueryOptions)
  const navigate = useNavigate()
  const selectedId = projectIdFromRoute(pathname)

  let body
  if (projects.isPending) {
    body = (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 4 }} role="status">
        <CircularProgress size={12} aria-hidden />
        <Typography variant="body2">読み込み中…</Typography>
      </Box>
    )
  } else if (projects.isError) {
    // 取得の失敗（IPC・DBエラー）。「プロジェクトがない」とは表示しない
    body = (
      <Alert severity="error" variant="outlined" sx={{ mx: 3 }}>
        プロジェクトを読み込めませんでした: {projects.error.message}
      </Alert>
    )
  } else if (projects.data.length === 0) {
    body = (
      <Typography variant="body2" color="text.secondary" sx={{ px: 4 }} role="status">
        プロジェクトはまだありません。
      </Typography>
    )
  } else {
    // 区分（未完了・完了済み）ごとに表示する。区分の中は名前順（同名は作成日時・ID）。選択はルートで決まるため、完了操作で区分が変わっても維持される
    const groups = groupProjects(projects.data)
    // 同名のプロジェクトは、作成日時とIDの先頭を副テキストで示して判別できるようにする（フェーズ5.4）
    const nameCounts = new Map<string, number>()
    for (const project of projects.data) nameCounts.set(project.name, (nameCounts.get(project.name) ?? 0) + 1)
    const secondaryOf = (project: ProjectDto) => {
      const parts: string[] = []
      if (project.completedAt !== null) parts.push('完了済み')
      if ((nameCounts.get(project.name) ?? 0) > 1) parts.push(`${formatTaskDateTime(project.createdAt)} 作成・ID ${project.id.slice(0, 8)}`)
      return parts.length > 0 ? parts.join('・') : undefined
    }
    const renderItem = (project: ProjectDto) => {
      const selected = project.id === selectedId
      return (
        <ListItemButton
          key={project.id}
          selected={selected}
          aria-current={selected ? 'page' : undefined}
          data-project-id={project.id}
          onClick={() => void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })}
          sx={{ px: 4 }}
        >
          <ListItemText
            primary={project.name}
            // 完了済みは色だけでなく文字でも示す
            secondary={secondaryOf(project)}
            slotProps={{ primary: { noWrap: true, sx: { fontSize: 13 } }, secondary: { sx: { fontSize: 11 } } }}
          />
        </ListItemButton>
      )
    }
    const section = (key: 'open' | 'completed', label: string, items: ProjectDto[]) => (
      <List
        key={key}
        dense
        disablePadding
        aria-labelledby={`project-section-${key}`}
        data-testid={`project-section-${key}`}
        subheader={
          <ListSubheader id={`project-section-${key}`} disableSticky sx={{ px: 4, lineHeight: '28px', fontSize: 11, bgcolor: 'transparent' }}>
            {label}（{items.length}）
          </ListSubheader>
        }
      >
        {items.length === 0 ? (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ px: 4, py: 0.5, m: 0 }}>
            なし
          </Typography>
        ) : (
          items.map(renderItem)
        )}
      </List>
    )
    body = (
      <Box data-testid="project-list" aria-label="プロジェクト一覧" role="group">
        {section('open', '未完了', groups.open)}
        {section('completed', '完了済み', groups.completed)}
      </Box>
    )
  }

  return (
    <>
      {body}
      {/* 区分の中ではなく、Project配下全体の最後に置く（0件・読み込み失敗時も表示） */}
      <List dense disablePadding aria-label="プロジェクトの作成">
        <NewProjectItem pathname={pathname} />
      </List>
    </>
  )
}
