import { useState, type ReactNode } from 'react'
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { projectIdFromRoute } from '../../../../shared/contracts/workspace'
import { ProjectsSidebar } from '../../features/projects/ProjectsSidebar'
import { projectListQueryOptions } from '../../features/projects/project-queries'
import { taskListQueryOptions } from '../../features/tasks/task-queries'
import { INBOX_SCOPE, isTaskInScope } from '../../features/tasks/task-scope'
import { vscodeColors } from '../../theme'
import { PaneHeader } from './PaneHeader'
import { SCREENS, screenOf, type ScreenId } from './screens'

// 幅広のナビゲーション（フェーズ5.4。旧アクティビティバー＋サイドバーを1つのペインに統合）。
// - Inbox / Projects（登録欄・未完了と完了済みの区分つきプロジェクト一覧）/ 設定 を縦に並べ、全体を縦スクロールする。
// - 選択状態はRouterの現在位置から導出する（aria-current）。プロジェクトの選択は既存の未保存確認（useBlocker）を通る。
// - Projects は折りたためる（保存しない）。折りたたんでも選択中のプロジェクト名は表示し、選択が分からなくならないようにする。
// - 幅は既存の左ペインの希望幅（Workspace設定の sidebarWidth、既定240px）をそのまま使う。
function NavItem({
  screen,
  active,
  secondary,
  onClick,
  trailing
}: {
  screen: ScreenId
  active: boolean
  secondary?: string | undefined
  onClick: () => void
  trailing?: ReactNode
}) {
  const { label, icon: Icon } = SCREENS[screen]
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <ButtonBase
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        sx={{
          flex: 1,
          minWidth: 0,
          justifyContent: 'flex-start',
          gap: 2,
          px: 3,
          height: 32,
          fontSize: 13,
          color: active ? vscodeColors.foreground : 'text.secondary',
          // 選択状態は左の線と文字色、キーボードフォーカスは枠線（テーマの:focus-visible）で区別する
          boxShadow: active ? `inset 2px 0 0 ${vscodeColors.foreground}` : 'none',
          bgcolor: active ? vscodeColors.listActiveSelection : 'transparent',
          '&:hover': { bgcolor: active ? vscodeColors.listActiveSelection : vscodeColors.listHover }
        }}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden />
        <Typography component="span" sx={{ fontSize: 13, fontWeight: 600 }}>
          {label}
        </Typography>
        {secondary && (
          <Typography component="span" noWrap sx={{ fontSize: 11, color: 'text.secondary', ml: 'auto' }}>
            {secondary}
          </Typography>
        )}
      </ButtonBase>
      {trailing}
    </Box>
  )
}

function useInboxSummary(): string | undefined {
  // Inboxの一覧と同じQueryを使う（追加の取得APIは使わない）。Inboxはプロジェクトに属さないタスク
  const tasks = useQuery(taskListQueryOptions)
  if (tasks.isPending) return '読み込み中…'
  if (tasks.isError) return '件数を取得できません'
  const open = tasks.data.filter((task) => isTaskInScope(task, INBOX_SCOPE) && task.completedAt === null).length
  return `未完了 ${open}`
}

export function NavigationPane({ pathname }: { pathname: string }) {
  const navigate = useNavigate()
  const screen = screenOf(pathname)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const projects = useQuery(projectListQueryOptions)
  const selectedProjectId = projectIdFromRoute(pathname)
  const selectedProject = projects.data?.find((project) => project.id === selectedProjectId)
  const inboxSummary = useInboxSummary()

  return (
    <Box
      component="nav"
      aria-label="ナビゲーション"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}
      data-testid="navigation"
    >
      <PaneHeader id="navigation-title" title="GTD" />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pb: 2 }}>
        <NavItem screen="inbox" active={screen === 'inbox'} secondary={inboxSummary} onClick={() => void navigate({ to: '/inbox' })} />
        <NavItem
          screen="projects"
          active={pathname === '/projects'}
          onClick={() => void navigate({ to: '/projects' })}
          trailing={
            <Tooltip title={projectsOpen ? 'プロジェクト一覧を折りたたむ' : 'プロジェクト一覧を表示'}>
              <IconButton
                aria-label={projectsOpen ? 'プロジェクト一覧を折りたたむ' : 'プロジェクト一覧を表示'}
                aria-expanded={projectsOpen}
                aria-controls="navigation-projects"
                onClick={() => setProjectsOpen((open) => !open)}
                sx={{ color: 'text.secondary', mr: 1 }}
              >
                {projectsOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              </IconButton>
            </Tooltip>
          }
        />
        <Box id="navigation-projects" sx={{ pt: 1 }}>
          {projectsOpen ? (
            <ProjectsSidebar pathname={pathname} />
          ) : (
            selectedProject && (
              // 折りたたみ中も、選択中のプロジェクトは分かるようにする
              <Typography variant="body2" noWrap sx={{ px: 5, py: 0.5, fontSize: 12 }} aria-current="page" data-testid="nav-selected-project">
                選択中: {selectedProject.name}
              </Typography>
            )
          )}
        </Box>
        <Box sx={{ mt: 2, borderTop: `1px solid ${vscodeColors.border}`, pt: 1 }}>
          <NavItem screen="settings" active={screen === 'settings'} onClick={() => void navigate({ to: '/settings' })} />
        </Box>
      </Box>
    </Box>
  )
}
