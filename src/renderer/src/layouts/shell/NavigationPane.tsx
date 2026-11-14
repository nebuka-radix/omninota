import { useState, type ReactNode } from 'react'
import { Box, ButtonBase, IconButton, Tooltip, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { projectIdFromRoute } from '../../../../shared/contracts/workspace'
import { ProjectsSidebar } from '../../features/projects/ProjectsSidebar'
import { projectListQueryOptions } from '../../features/projects/project-queries'
import { taskListQueryOptions } from '../../features/tasks/task-queries'
import { mergeSummary } from '../../features/summary/summary-merge'
import { summaryQueryOptions } from '../../features/summary/summary-queries'
import { useLocalDay } from '../../lib/local-day'
import { vscodeColors } from '../../theme'
import { PaneHeader } from './PaneHeader'
import { SCREENS, screenOf, type ScreenId } from './screens'

// 幅広のナビゲーション（フェーズ5.4。旧アクティビティバー＋サイドバーを1つのペインに統合）。
// - Summary Review（フェーズ6）/ Inbox / Project（未完了のプロジェクト一覧、最下段に NEW PROJECT。フェーズ5.8で区分を廃止）/ 設定 を縦に並べ、全体を縦スクロールする。
// - 狭い幅（最小幅はWORKSPACE_LIMITS.sidebarWidth.min）では項目名を省略表示し、バッジ・折りたたみボタンは常に表示する。
// - 選択状態はRouterの現在位置から導出する（aria-current）。プロジェクトの選択は既存の未保存確認（useBlocker）を通る。
// - Project は折りたためる（保存しない）。折りたたんでも選択中のプロジェクト名は表示し、選択が分からなくならないようにする。
// - 幅は既存の左ペインの希望幅（Workspace設定の sidebarWidth、既定240px）をそのまま使う。
// フェーズ5.5: Inbox の件数は行内のバッジで示す（項目名のラベルは出さない）。バッジは別の操作対象にせず、
// ボタンの一部とする。読み上げでは件数を説明（aria-describedby）として伝える（ボタンの名前は「Inbox」のまま）。
type NavBadge = { key: string; text: string; description: string; background: string }

function NavItem({
  screen, active, badges = [], onClick, trailing
}: {
  screen: ScreenId
  active: boolean
  badges?: readonly NavBadge[] | undefined
  onClick: () => void
  trailing?: ReactNode
}) {
  const { label, icon: Icon } = SCREENS[screen]
  const descriptionId = `nav-${screen}-badge-description`
  return (
    <Box sx={{ display: 'flex', alignItems: 'center' }}>
      <ButtonBase
        aria-label={label}
        aria-describedby={badges.length > 0 ? descriptionId : undefined}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        sx={{
          flex: 1, minWidth: 0, justifyContent: 'flex-start', gap: 2, px: 3,
          height: 32, fontSize: 13,
          color: active ? vscodeColors.foreground : 'text.secondary',
          boxShadow: active ? `inset 2px 0 0 ${vscodeColors.foreground}` : 'none',
          bgcolor: active ? vscodeColors.listActiveSelection : 'transparent',
          '&:hover': { bgcolor: active ? vscodeColors.listActiveSelection : vscodeColors.listHover }
        }}
      >
        <Icon size={16} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0 }} />
        <Typography component="span" noWrap sx={{ fontSize: 13, fontWeight: 600, minWidth: 0 }}>
          {label}
        </Typography>
        {badges.length > 0 && (
          <>
            <Box component="span" sx={{ ml: 'auto', flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              {badges.map((badge) => (
                <Box component="span" key={badge.key} aria-hidden title={badge.description}
                  data-testid={screen === 'inbox' ? 'nav-inbox-badge' : `nav-${screen}-${badge.key}-badge`}
                  data-count-kind={badge.key}
                  sx={{
                    flexShrink: 0, minWidth: '20px', height: '20px', px: '4px',
                    boxSizing: 'border-box', borderRadius: '10px', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: '13px',
                    fontWeight: 800, lineHeight: 1, color: '#ffffff', bgcolor: badge.background,
                    fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'
                  }}>
                  {badge.text}
                </Box>
              ))}
            </Box>
            <Box component="span" id={descriptionId}
              sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
              {badges.map((badge) => badge.description).join('、')}
            </Box>
          </>
        )}
      </ButtonBase>
      {trailing}
    </Box>
  )
}

function useNavigationBadges(): { summaryBadges: NavBadge[]; inboxBadges: NavBadge[] } {
  const day = useLocalDay()
  const tasks = useQuery(taskListQueryOptions)
  const summary = useQuery(summaryQueryOptions(day))
  const summaryBadges: NavBadge[] = []
  const inboxBadges: NavBadge[] = []
  // コンパクト画面と同じQuery・集計処理を使う。
  if (summary.isSuccess) {
    const merged = mergeSummary(summary.data, tasks.data)
    const overdue = merged.overdueItems.length
    const today = merged.todayItems.length
    if (overdue > 0) summaryBadges.push({ key: 'overdue', text: String(overdue), description: `期限超過 ${overdue} 件`, background: '#b91c1c' })
    if (today > 0) summaryBadges.push({ key: 'today', text: String(today), description: `今日のタスク ${today} 件`, background: '#1e90ff' })
  }
  if (tasks.isSuccess) {
    const open = tasks.data.filter((task) => task.projectId === null && task.doneOn === null).length
    if (open > 0) inboxBadges.push({ key: 'inbox', text: String(open), description: `未完了のタスク ${open} 件`, background: '#008080' })
  }
  return { summaryBadges, inboxBadges }
}

export function NavigationPane({ pathname }: { pathname: string }) {
  const navigate = useNavigate()
  const screen = screenOf(pathname)
  const [projectsOpen, setProjectsOpen] = useState(true)
  const projects = useQuery(projectListQueryOptions)
  const selectedProjectId = projectIdFromRoute(pathname)
  // 完了済みのプロジェクトはサイドバーに表示しないため、折りたたみ中の「選択中」にも出さない（フェーズ5.8）
  const selectedProject = projects.data?.find((project) => project.id === selectedProjectId && !project.done)
  const { summaryBadges, inboxBadges } = useNavigationBadges()

  return (
    <Box
      component="nav"
      aria-label="ナビゲーション"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', minWidth: 0 }}
      data-testid="navigation"
    >
      <PaneHeader id="navigation-title" title="GTD" />
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', pb: 2 }}>
        {/* Summary Review（フェーズ6）は Inbox の直上 */}
        <NavItem screen="summary" active={screen === 'summary'} badges={summaryBadges} onClick={() => void navigate({ to: '/summary' })} />
        <NavItem screen="inbox" active={screen === 'inbox'} badges={inboxBadges} onClick={() => void navigate({ to: '/inbox' })} />
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
                sx={{ color: 'text.secondary', mr: 1, flexShrink: 0 }}
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
