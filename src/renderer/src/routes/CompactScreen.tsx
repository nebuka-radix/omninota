import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Alert, Box, Button, CircularProgress, Tab, Tabs, Tooltip, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { ListChevronsDownUp, ListChevronsUpDown, ListTree, FolderKanban, Flag } from 'lucide-react'
import { useDraftGuard } from '../features/drafts/DraftGuard'
import { projectListQueryOptions } from '../features/projects/project-queries'
import { sortProjects } from '../features/projects/project-order'
import { milestoneListQueryOptions } from '../features/milestones/milestone-queries'
import { buildTaskGroups, compareManualOrder, disambiguatedNames } from '../features/tasks/assignment'
import { TaskQuickAdd } from '../features/tasks/TaskQuickAdd'
import { TaskList } from '../features/tasks/TaskList'
import { taskListQueryOptions, usePendingTaskIds } from '../features/tasks/task-queries'
import { useTaskRowActions } from '../features/tasks/use-task-row-actions'
import type { TaskDto } from '../../../shared/contracts/tasks'
import { vscodeColors } from '../theme'
import { SummaryPage } from './SummaryPage'
import { SectionRow } from '../components/SectionRow'
import { ShellSlot } from '../components/ShellSlots'

type CompactTab = 'day' | 'inbox' | 'project'
const EMPTY_TASKS: TaskDto[] = []
const labels = { day: 'THE DAY', inbox: 'INBOX', project: 'PROJECT' } as const

export function CompactScreen() {
  const [tab, setTab] = useState<CompactTab>('day')
  const [error, setError] = useState<string | null>(null)
  const switching = useRef(false)
  const { confirmLeave } = useDraftGuard()
  const changeTab = async (next: CompactTab) => {
    if (next === tab || switching.current) return
    switching.current = true
    try {
      if (await confirmLeave()) { setError(null); setTab(next) }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'タブを切り替えられませんでした')
    } finally { switching.current = false }
  }
  return (
    <Box sx={{ height: '100%', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ px: 2, pt: 3, flexShrink: 0 }}><TaskQuickAdd projectId={null} /></Box>
      <Tabs value={tab} onChange={(_event, value: CompactTab) => void changeTab(value)} aria-label="コンパクト表示" variant="fullWidth"
        sx={{ minHeight: 32, flexShrink: 0, borderBottom: `1px solid ${vscodeColors.border}`, '& .MuiTab-root': { minWidth: 0, minHeight: 32, p: 1, fontSize: 11 } }}>
        {(Object.keys(labels) as CompactTab[]).map((key) => <Tab key={key} value={key} label={labels[key]} id={`compact-tab-${key}`} aria-controls={`compact-panel-${key}`} />)}
      </Tabs>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Box role="tabpanel" id={`compact-panel-${tab}`} aria-labelledby={`compact-tab-${tab}`} tabIndex={0}
        sx={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'day' ? <SummaryPage compact showQuickAdd={false} /> : <CompactTaskBrowser key={tab} kind={tab} />}
      </Box>
    </Box>
  )
}


// マイルストン名と、実際に描画されたチェックアイコンの左端を揃える。
function MilestoneTaskIndent({ titleId, children }: { titleId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [indent, setIndent] = useState(102)
  useLayoutEffect(() => {
    const element = ref.current
    const title = document.getElementById(titleId)
    if (!element || !title) return
    const align = () => {
      const checkbox = element.querySelector('.MuiCheckbox-root svg')
      const left = element.getBoundingClientRect().left
      const padding = Number.parseFloat(getComputedStyle(element).paddingLeft) || 0
      const iconOffset = checkbox ? checkbox.getBoundingClientRect().left - left - padding : 0
      const next = Math.max(0, title.getBoundingClientRect().left - left - iconOffset)
      setIndent((current) => Math.abs(current - next) > 0.5 ? next : current)
    }
    align()
    const observer = new ResizeObserver(align)
    observer.observe(element)
    observer.observe(title)
    return () => observer.disconnect()
  })
  return <Box ref={ref} sx={{ pl: `${indent}px`, minWidth: 0, boxSizing: 'border-box' }}>{children}</Box>
}

function CompactTaskBrowser({ kind }: { kind: 'inbox' | 'project' }) {
  const tasksQuery = useQuery(taskListQueryOptions)
  const projectsQuery = useQuery(projectListQueryOptions)
  const milestonesQuery = useQuery(milestoneListQueryOptions)
  const [expandedNodes, setExpandedNodes] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const busy = useRef(false)
  const { confirmLeave } = useDraftGuard()
  const pendingTaskIds = usePendingTaskIds()
  const allTasks = tasksQuery.data ?? EMPTY_TASKS
  const rowActions = useTaskRowActions({ tasks: allTasks, onAnnounce: setAnnouncement })
  const projects = sortProjects(projectsQuery.data ?? []).filter((project) => !project.done)
  const projectLabels = disambiguatedNames(projects)
  const inboxTasks = allTasks.filter((task) => task.projectId === null && task.doneOn === null).sort(compareManualOrder)
  const tasksByProject = new Map<string, TaskDto[]>()
  for (const task of allTasks) {
    if (task.projectId === null || task.doneOn !== null) continue
    const list = tasksByProject.get(task.projectId)
    if (list) list.push(task)
    else tasksByProject.set(task.projectId, [task])
  }
  const milestoneRows = milestonesQuery.data ?? []
  const milestonesByProject = new Map<string, typeof milestoneRows>()
  for (const milestone of milestoneRows) {
    if (milestone.projectId === null) continue
    const list = milestonesByProject.get(milestone.projectId)
    if (list) list.push(milestone)
    else milestonesByProject.set(milestone.projectId, [milestone])
  }

  const toggle = async (key: string) => {
    if (busy.current) return
    busy.current = true
    try {
      const closing = expandedNodes.has(key)
      if (closing && !(await confirmLeave())) return
      setNavigationError(null)
      setExpandedNodes((current) => {
        const next = new Set(current)
        if (next.has(key)) next.delete(key)
        else next.add(key)
        return next
      })
    } catch (cause) {
      setNavigationError(cause instanceof Error ? cause.message : '表示を変更できませんでした')
    } finally { busy.current = false }
  }
  const setAllExpanded = async (mode: 'none' | 'milestones' | 'all') => {
    if (busy.current) return
    busy.current = true
    try {
      if (mode !== 'all' && !(await confirmLeave())) return
      setNavigationError(null)
      const projectIds = new Set(projects.map((project) => project.id))
      setExpandedNodes(mode === 'none' ? new Set() : new Set([
        ...projects.map((project) => `project:${project.id}`),
        ...(mode === 'all' ? milestoneRows.filter((milestone) => milestone.projectId !== null && projectIds.has(milestone.projectId))
          .map((milestone) => `milestone:${milestone.id}`) : [])
      ]))
    } catch (cause) {
      setNavigationError(cause instanceof Error ? cause.message : '展開状態を変更できませんでした')
    } finally { busy.current = false }
  }
  const renderList = (tasks: readonly TaskDto[], label: string, projectTree = false) => (
    <TaskList variant="section" rowMode="Compact" parentVisible={!projectTree}
      tasks={tasks} actions={rowActions.actions} listLabel={label}
      totalCount={tasks.length} selectedTaskId={selectedId} pendingTaskIds={pendingTaskIds}
      resetScrollKey={kind} onSelect={setSelectedId}
      onRequestDelete={(task) => rowActions.deleteTasks([task])}
      maxVisibleRows={projectTree ? Math.max(1, tasks.length) : undefined} />
  )
  const loading = tasksQuery.isPending || (kind === 'project' && (projectsQuery.isPending || milestonesQuery.isPending))
  const error = tasksQuery.error ?? (kind === 'project' ? projectsQuery.error ?? milestonesQuery.error : null)
  let body: ReactNode
  if (error) body = <Alert severity="error">読み込めませんでした: {error.message}</Alert>
  else if (loading) body = <Box role="status" sx={{ p: 2 }}><CircularProgress size={16} /> 読み込み中…</Box>
  else if (kind === 'inbox') body = inboxTasks.length > 0
    ? renderList(inboxTasks, `Inbox（${inboxTasks.length}件）`)
    : <Typography sx={{ p: 2, fontSize: 12 }}>Inboxに未完了のタスクはありません</Typography>
  else body = (
    <Box component="ul" aria-label="プロジェクト・マイルストン・タスク" data-testid="compact-project-tree"
      sx={{ m: 0, p: 0, listStyle: 'none', flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}>
      {projects.length === 0 && <Box component="li" sx={{ p: 2, fontSize: 12 }}>未完了のプロジェクトがありません</Box>}
      {projects.map((project) => {
        const projectKey = `project:${project.id}`
        const projectExpanded = expandedNodes.has(projectKey)
        const projectLabel = projectLabels.get(project.id) ?? project.name
        const projectTitleId = `compact-project-title-${project.id}`
        const projectContentId = `compact-project-content-${project.id}`
        const groups = buildTaskGroups(
          [...(tasksByProject.get(project.id) ?? [])].sort(compareManualOrder),
          milestonesByProject.get(project.id) ?? []
        )
        return (
          <Box component="li" key={project.id} sx={{ minWidth: 0 }}>
            <SectionRow level={0} title={projectLabel} titleId={projectTitleId} icon={FolderKanban}
              height={32} sx={{ mt: '8px' }}
              expanded={projectExpanded} onExpandedChange={() => void toggle(projectKey)} controlsId={projectContentId} />
            <Box id={projectContentId} hidden={!projectExpanded}>
              {projectExpanded && (
                <Box component="ul" aria-labelledby={projectTitleId} sx={{ listStyle: 'none', m: 0, p: 0 }}>
                  {groups.length === 0 && <Box component="li" sx={{ pl: '36px', py: 1, fontSize: 12, color: 'text.secondary' }}>マイルストンはありません</Box>}
                  {groups.map((group) => {
                    const milestoneKey = `milestone:${group.milestoneId}`
                    const milestoneExpanded = expandedNodes.has(milestoneKey)
                    const titleId = `compact-milestone-title-${group.milestoneId}`
                    const contentId = `compact-milestone-content-${group.milestoneId}`
                    return (
                      <Box component="li" key={group.key} sx={{ minWidth: 0 }}>
                        <SectionRow level={1} title={group.label} titleId={titleId} icon={Flag}
                          height={28}
                          expanded={milestoneExpanded} onExpandedChange={() => void toggle(milestoneKey)} controlsId={contentId} />
                        <Box id={contentId} hidden={!milestoneExpanded}>
                          <MilestoneTaskIndent titleId={titleId}>
                          {milestoneExpanded && (group.tasks.length > 0
                            ? renderList(group.tasks, `${projectLabel} / ${group.label}の未完了タスク`, true)
                            : <Typography sx={{ py: 1, px: 1, fontSize: 12, color: 'text.secondary' }}>未完了のタスクはありません</Typography>)}
                          </MilestoneTaskIndent>
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
    </Box>
  )
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      {kind === 'project' && (
        <ShellSlot name="top-bar-controls">
          <Box
            role="group" aria-label="プロジェクト階層の操作"
            sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 1, width: 'max-content', maxWidth: '100%', minWidth: 0, overflowX: 'auto', overflowY: 'hidden', color: '#ffffff' }}
          >
            <Tooltip title="すべて折りたたむ">
              <span style={{ display: 'flex', flex: '0 0 auto' }}>
                <Button size="small" aria-label="すべて折りたたむ"
                  disabled={loading || error !== null || projects.length === 0}
                  onClick={() => void setAllExpanded('none')}
                  data-testid="compact-project-collapse-all"
                  sx={{ minWidth: 0, px: 0.5, gap: '4px', justifyContent: 'flex-start', fontSize: 11, whiteSpace: 'nowrap', color: '#ffffff', '&.Mui-disabled': { color: '#ffffff', opacity: 0.4 } }}>
                  <ListChevronsDownUp size={16} aria-hidden style={{ flexShrink: 0 }} />
                  <Box component="span" sx={{ whiteSpace: 'nowrap', color: 'inherit' }}>すべて折りたたむ</Box>
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="マイルストンまで展開">
              <span style={{ display: 'flex', flex: '0 0 auto' }}>
                <Button size="small" aria-label="マイルストンまで展開"
                  disabled={loading || error !== null || projects.length === 0}
                  onClick={() => void setAllExpanded('milestones')}
                  data-testid="compact-project-expand-milestones"
                  sx={{ minWidth: 0, px: 0.5, gap: '4px', justifyContent: 'flex-start', fontSize: 11, whiteSpace: 'nowrap', color: '#ffffff', '&.Mui-disabled': { color: '#ffffff', opacity: 0.4 } }}>
                  <ListTree size={16} aria-hidden style={{ flexShrink: 0 }} />
                  <Box component="span" sx={{ whiteSpace: 'nowrap', color: 'inherit' }}>マイルストンまで展開</Box>
                </Button>
              </span>
            </Tooltip>
            <Tooltip title="すべて展開">
              <span style={{ display: 'flex', flex: '0 0 auto' }}>
                <Button size="small" aria-label="すべて展開"
                  disabled={loading || error !== null || projects.length === 0}
                  onClick={() => void setAllExpanded('all')}
                  data-testid="compact-project-expand-all"
                  sx={{ minWidth: 0, px: 0.5, gap: '4px', justifyContent: 'flex-start', fontSize: 11, whiteSpace: 'nowrap', color: '#ffffff', '&.Mui-disabled': { color: '#ffffff', opacity: 0.4 } }}>
                  <ListChevronsUpDown size={16} aria-hidden style={{ flexShrink: 0 }} />
                  <Box component="span" sx={{ whiteSpace: 'nowrap', color: 'inherit' }}>すべて展開</Box>
                </Button>
              </span>
            </Tooltip>
          </Box>
        </ShellSlot>
      )}
      <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{announcement}</Box>
      {navigationError && <Alert severity="error" onClose={() => setNavigationError(null)}>{navigationError}</Alert>}
      <Box sx={{ flexShrink: 0 }}>{rowActions.alerts}</Box>
      {body}
      {rowActions.elements}
    </Box>
  )
}
