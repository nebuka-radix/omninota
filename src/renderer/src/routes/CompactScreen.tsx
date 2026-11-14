import { useRef, useState, type ReactNode } from 'react'
import { Alert, Box, ButtonBase, CircularProgress, Tab, Tabs, TextField, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
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

type CompactTab = 'day' | 'inbox' | 'project'
const EMPTY_TASKS: TaskDto[] = []
const labels = { day: 'THE DAY', inbox: 'INBOX', project: 'PROJECT' } as const

export function CompactScreen() {
  const [tab, setTab] = useState<CompactTab>('day')
  const [dayPercent, setDayPercent] = useState(50)
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
        {tab === 'day' ? <SummaryPage compact showQuickAdd={false} compactSplit={{ value: dayPercent, onChange: setDayPercent }} /> : <CompactTaskBrowser key={tab} kind={tab} />}
      </Box>
    </Box>
  )
}

function CompactTaskBrowser({ kind }: { kind: 'inbox' | 'project' }) {
  const tasksQuery = useQuery(taskListQueryOptions)
  const projectsQuery = useQuery(projectListQueryOptions)
  const milestonesQuery = useQuery(milestoneListQueryOptions)
  const [projectId, setProjectId] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const busy = useRef(false)
  const { confirmLeave } = useDraftGuard()
  const pendingTaskIds = usePendingTaskIds()
  const allTasks = tasksQuery.data ?? EMPTY_TASKS
  const rowActions = useTaskRowActions({ tasks: allTasks, onAnnounce: setAnnouncement })
  const projects = sortProjects(projectsQuery.data ?? [])
  const projectLabels = disambiguatedNames(projects)
  // 保存対象ではないため、未選択・削除された場合は先頭のプロジェクトを選ぶ。
  const selectedProject = projects.find((item) => item.id === projectId) ?? projects[0]
  const selectedProjectId = selectedProject?.id ?? ''
  const inboxTasks = allTasks.filter((task) => task.projectId === null).sort(compareManualOrder)
  const ownTasks = allTasks.filter((task) => task.projectId === selectedProjectId).sort(compareManualOrder)
  const groups = buildTaskGroups(ownTasks, (milestonesQuery.data ?? []).filter((item) => item.projectId === selectedProjectId))

  const guarded = async (action: () => void) => {
    if (busy.current) return
    busy.current = true
    try {
      if (await confirmLeave()) { setNavigationError(null); action() }
    } catch (cause) {
      setNavigationError(cause instanceof Error ? cause.message : '表示を変更できませんでした')
    } finally { busy.current = false }
  }
  const toggle = (id: string) => {
    const apply = () => setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    if (collapsed.has(id)) apply()
    else void guarded(apply)
  }
  const renderList = (tasks: readonly TaskDto[], label: string, fixed = false) => (
    <TaskList variant="section" tasks={tasks} actions={rowActions.actions} listLabel={label}
      totalCount={tasks.length} selectedTaskId={selectedId} pendingTaskIds={pendingTaskIds}
      resetScrollKey={`${kind}:${selectedProjectId}`} onSelect={setSelectedId}
      onRequestDelete={(task) => rowActions.deleteTasks([task])}
      maxVisibleRows={fixed ? 6 : undefined} />
  )
  const loading = tasksQuery.isPending || (kind === 'project' && (projectsQuery.isPending || milestonesQuery.isPending))
  const error = tasksQuery.error ?? (kind === 'project' ? projectsQuery.error ?? milestonesQuery.error : null)
  let body: ReactNode
  if (error) body = <Alert severity="error">読み込めませんでした: {error.message}</Alert>
  else if (loading) body = <Box role="status" sx={{ p: 2 }}><CircularProgress size={16} /> 読み込み中…</Box>
  else if (kind === 'inbox') body = inboxTasks.length > 0 ? renderList(inboxTasks, `Inbox（${inboxTasks.length}件）`) : <Typography sx={{ p: 2, fontSize: 12 }}>Inboxにタスクはありません</Typography>
  else body = (
    <>
      <Box sx={{ p: 2, flexShrink: 0 }}>
        <TextField select fullWidth size="small" label="プロジェクト" value={selectedProjectId}
          disabled={projects.length === 0} slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
          onChange={(event) => {
            const next = event.target.value
            void guarded(() => { setProjectId(next); setSelectedId(null); setCollapsed(new Set()) })
          }}>
          {projects.length === 0 ? <option value="">プロジェクトがありません</option> : projects.map((project) => (
            <option key={project.id} value={project.id}>{projectLabels.get(project.id) ?? project.name}{project.done ? '（完了済み）' : ''}</option>
          ))}
        </TextField>
      </Box>
      <Box component="ul" aria-label="マイルストンとタスク" sx={{ m: 0, p: 0, listStyle: 'none', flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
        {groups.length === 0 && <Box component="li" sx={{ p: 2, fontSize: 12 }}>マイルストンはありません</Box>}
        {groups.map((group) => {
          const expanded = !collapsed.has(group.milestoneId)
          const Chevron = expanded ? ChevronDown : ChevronRight
          return (
            <Box component="li" key={group.key} sx={{ minWidth: 0, borderBottom: `1px solid ${vscodeColors.border}` }}>
              <ButtonBase aria-expanded={expanded} aria-controls={`compact-milestone-${group.milestoneId}`}
                onClick={() => toggle(group.milestoneId)}
                sx={{ width: '100%', display: 'flex', justifyContent: 'flex-start', minHeight: 30, gap: 1, px: 1, fontSize: 12 }}>
                <Chevron size={14} aria-hidden style={{ flexShrink: 0 }} />
                <Typography component="span" noWrap title={group.label} sx={{ fontSize: 12, minWidth: 0 }}>{group.label}</Typography>
                <Typography component="span" sx={{ ml: 'auto', flexShrink: 0, fontSize: 11 }}>{group.tasks.length} 件</Typography>
              </ButtonBase>
              <Box id={`compact-milestone-${group.milestoneId}`} hidden={!expanded} sx={{ pl: 2, minWidth: 0 }}>
                {expanded && (group.tasks.length > 0 ? renderList(group.tasks, `${group.label}のタスク`, true) : <Typography sx={{ p: 2, fontSize: 12, color: 'text.secondary' }}>タスクはありません</Typography>)}
              </Box>
            </Box>
          )
        })}
      </Box>
    </>
  )
  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      <Box role="status" aria-live="polite" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>{announcement}</Box>
      {navigationError && <Alert severity="error" onClose={() => setNavigationError(null)}>{navigationError}</Alert>}
      <Box sx={{ flexShrink: 0 }}>{rowActions.alerts}</Box>
      {body}
      {rowActions.elements}
    </Box>
  )
}
