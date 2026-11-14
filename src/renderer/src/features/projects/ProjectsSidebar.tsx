import {
  Alert,
  Box,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Typography
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import { projectIdFromRoute } from '../../../../shared/contracts/workspace'
import { formatTaskDateTime } from '../tasks/TaskList'
import { NEW_PROJECT_PATH, rememberNewProjectReturn } from './new-project'
import { compareFavoriteProjects, groupProjects } from './project-order'
import { ProjectFavoriteButton } from './ProjectFavoriteButton'
import { projectListQueryOptions } from './project-queries'

// Projectの左サイドバー: 未完了のプロジェクト一覧と、最下段の「NEW PROJECT」（フェーズ5.5。区分の廃止はフェーズ5.8）。
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
      sx={{ px: 4, gap: 1.5, mt: 1, minWidth: 0 }}
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
  } else {
    // 未完了のプロジェクトだけを、Project 配下にそのまま並べる（名前順。同名は作成日時・ID）。
    // フェーズ5.8: 「未完了」の見出しと完了済みの区分は廃止した。完了済みのプロジェクトはサイドバーに表示しない（データは残る）。
    // 完了した直後も開いている画面はそのまま（ルートで決まる）で、完了を取り消すと一覧に戻る。
    const openProjects = groupProjects(projects.data).open.sort(compareFavoriteProjects)
    // 同名のプロジェクトは、作成日時とIDの先頭を副テキストで示して判別できるようにする（フェーズ5.4。一覧に表示するものの中で判定）
    const nameCounts = new Map<string, number>()
    for (const project of openProjects) nameCounts.set(project.name, (nameCounts.get(project.name) ?? 0) + 1)
    const secondaryOf = (project: ProjectDto) =>
      (nameCounts.get(project.name) ?? 0) > 1 ? `${formatTaskDateTime(project.createdAt)} 作成・ID ${project.id.slice(0, 8)}` : undefined
    body =
      openProjects.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 4 }} role="status" data-testid="project-list-empty">
          {projects.data.length === 0 ? 'プロジェクトはまだありません。' : '未完了のプロジェクトはありません。'}
        </Typography>
      ) : (
        <List dense disablePadding aria-label="プロジェクト一覧" data-testid="project-list">
          {openProjects.map((project) => {
            const selected = project.id === selectedId
            return (
              <Box component="li" key={project.id} sx={{ display: 'flex', alignItems: 'center', px: 4, minWidth: 0 }}>
                <ProjectFavoriteButton project={project} />
              <ListItemButton
                selected={selected}
                aria-current={selected ? 'page' : undefined}
                data-project-id={project.id}
                onClick={() => void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })}
                sx={{ px: 0.5, minWidth: 0, flex: 1 }}
              >
                <ListItemText
                  primary={project.name}
                  secondary={secondaryOf(project)}
                  sx={{ minWidth: 0 }}
                  // 狭い幅では省略表示する（メイン領域へはみ出さない）
                  slotProps={{
                    primary: { noWrap: true, title: project.name, sx: { fontSize: 13 } },
                    secondary: { noWrap: true, sx: { fontSize: 11 } }
                  }}
                />
              </ListItemButton>
              </Box>
            )
          })}
        </List>
      )
  }

  return (
    <>
      {body}
      {/* 一覧の後、Project配下の最下段に置く（0件・読み込み失敗時も表示） */}
      <List dense disablePadding aria-label="プロジェクトの作成">
        <NewProjectItem pathname={pathname} />
      </List>
    </>
  )
}
