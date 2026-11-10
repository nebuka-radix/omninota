import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  InputAdornment,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useTable, type SortingState } from '@tanstack/react-table'
import { Pencil, Plus, Search } from 'lucide-react'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { milestoneListQueryOptions } from '../milestones/milestone-queries'
import { useDraftGuard } from '../drafts/DraftGuard'
import { projectListQueryOptions } from '../projects/project-queries'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { AssignMenu } from './AssignMenu'
import { buildTaskGroups, milestonesOf, type Assignment, type TaskGroup } from './assignment'
import { TASK_LIST_HELP_ID, TaskList } from './TaskList'
import { TaskQuickAdd } from './TaskQuickAdd'
import {
  taskListQueryOptions,
  usePendingTaskIds,
  useSetTaskAssignmentMutation,
  useSetTaskCompletedMutation
} from './task-queries'
import { reopenBlockedReason, shouldClearSearchToRevealOpen } from './task-rules'
import { isTaskInScope, scopeProjectId, taskScopeKey, type TaskScope } from './task-scope'
import {
  DEFAULT_TASK_STATUS,
  nextSorting,
  scopeAndStatusFilterState,
  taskColumns,
  taskTableFeatures,
  taskTableOptions,
  type TaskStatusFilter
} from './task-table'

const EMPTY_TASKS: TaskDto[] = []

const STATUS_LABELS: Record<TaskStatusFilter, string> = { open: '未完了', completed: '完了', all: 'すべて' }

// 表示範囲（Inbox / プロジェクト）のタスク一覧と追加欄（フェーズ5.2でInboxから共通化）。
// Queryが全件を取得し、Tableが範囲・状態・検索で絞り込んでソートし、Virtualが表示範囲だけを描画する。
// （仮想化は描画量を減らすだけで、DBからの取得件数は減らない）
// - 検索・状態フィルターはこのコンポーネントの状態。範囲を切り替える時は key で作り直して初期化する。
//   状態の初期値は呼び出し側が決める（完了済みプロジェクトは「完了」。フェーズ5.3）。
// - revealOpenRequest が増えたら「未完了のタスクを表示」: 状態を未完了にし、検索で隠れる未完了タスクがあれば検索をクリアし、
//   先頭へスクロールする（範囲・選択・ドラフトは変えない。フェーズ5.3）。
// - ソートは呼び出し側が持つ（プロジェクトを切り替えても維持する）。
// - 別の範囲を開いたら、タスクの選択を解除する（WorkspaceContext.enterTaskScope）。
// フェーズ5.4:
// - Inbox: 各行の「紐付け」（キーボードは M）から AssignMenu を開き、最終的な所属先を1回で保存する。
//   保存に成功した後だけ（Queryキャッシュの更新で）一覧から消える。失敗時は行を残し、理由を表示する。
// - プロジェクト: マイルストン別のグループ（マイルストンの作成順、最後に「マイルストン未設定」）を、1つの仮想リストに並べる。
//   検索・状態・ソートは全グループ共通。空のグループも見出しと「＋タスク追加」を表示する。
//   「＋タスク追加」は上の追加欄の追加先をそのグループに切り替えてフォーカスする（入力欄を仮想行の中に置かない）。
export function TaskScopeView({
  scope,
  scopeLabel,
  addTargetLabel,
  addDisabledReason,
  sorting,
  onSortingChange,
  initialStatus = DEFAULT_TASK_STATUS,
  revealOpenRequest = 0,
  project,
  onRenameMilestone
}: {
  scope: TaskScope
  // 一覧の説明（「プロジェクトに属さないタスク」など。対象外の表示に使う）
  scopeLabel: string
  addTargetLabel: string
  addDisabledReason?: string | undefined
  sorting: SortingState
  onSortingChange: (updater: SortingState | ((current: SortingState) => SortingState)) => void
  initialStatus?: TaskStatusFilter
  revealOpenRequest?: number
  // プロジェクト画面の場合の対象プロジェクト（マイルストン別の表示・追加先の表示に使う）
  project?: ProjectDto | undefined
  onRenameMilestone?: ((milestoneId: string) => void) | undefined
}) {
  const tasksQuery = useQuery(taskListQueryOptions)
  const data = tasksQuery.data ?? EMPTY_TASKS
  const { selectedTaskId, selectTask, enterTaskScope } = useWorkspace()
  const { confirmLeave } = useDraftGuard()
  const pendingTaskIds = usePendingTaskIds()
  const setCompleted = useSetTaskCompletedMutation()
  const projectsQuery = useQuery(projectListQueryOptions)
  const milestonesQuery = useQuery(milestoneListQueryOptions)
  const setAssignment = useSetTaskAssignmentMutation()
  // 紐付けメニューの対象（Inbox）
  const [assignTarget, setAssignTarget] = useState<{ task: TaskDto; anchor: HTMLElement } | null>(null)
  // プロジェクト画面の追加先（null = マイルストン未設定）
  const [addMilestoneId, setAddMilestoneId] = useState<string | null>(null)
  const quickAddInputRef = useRef<HTMLInputElement>(null)
  const scopeKey = taskScopeKey(scope)
  // 呼び出し側が毎回新しいオブジェクトを渡しても、範囲が同じなら同じ値を使う（Tableの絞り込みを作り直さない）
  const stableScope = useMemo(() => scope, [scopeKey]) // scope は scopeKey と一対一

  useEffect(() => {
    enterTaskScope(scopeKey)
  }, [enterTaskScope, scopeKey])

  // 検索・表示切り替えは画面内の状態（保存しない）
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<TaskStatusFilter>(initialStatus)
  // 完了切り替えの結果を読み上げる（ライブリージョン）
  const [announcement, setAnnouncement] = useState('')
  // 操作できない理由（完了済みプロジェクトのタスクを未完了に戻そうとした時。Main側でも拒否する）
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null)

  // 「未完了のタスクを表示」の要求（マウント時の値は処理済みとして扱う）
  const handledRevealRef = useRef(revealOpenRequest)
  useEffect(() => {
    if (revealOpenRequest === handledRevealRef.current) return
    handledRevealRef.current = revealOpenRequest
    setStatus('open')
    if (shouldClearSearchToRevealOpen(data, stableScope, search)) setSearch('')
    setAnnouncement('未完了のタスクを表示しました')
  }, [revealOpenRequest, data, stableScope, search])

  // Tableへ渡す状態は値が変わった時だけ作り直す（毎回新しい配列だと行モデルが作り直される）
  const columnFilters = useMemo(() => scopeAndStatusFilterState(stableScope, status), [stableScope, status])

  const table = useTable({
    features: taskTableFeatures,
    columns: taskColumns,
    data,
    ...taskTableOptions,
    state: { sorting, globalFilter: search, columnFilters },
    onSortingChange
  })
  const visibleTasks = table.getRowModel().rows.map((row) => row.original)
  const projectMilestones = useMemo(
    () => (project ? milestonesOf(milestonesQuery.data ?? [], project.id) : []),
    [project, milestonesQuery.data]
  )
  // マイルストン別のグループ（プロジェクト画面だけ）。Tableで絞り込み・ソートした順序のまま振り分ける
  const groups = project ? buildTaskGroups(visibleTasks, projectMilestones) : null
  const addMilestone = projectMilestones.find((milestone) => milestone.id === addMilestoneId) ?? null
  const projectCompleted = project !== undefined && project.completedAt !== null
  const scopeCount = useMemo(() => data.filter((task) => isTaskInScope(task, stableScope)).length, [data, stableScope])

  const selectedTask = selectedTaskId ? data.find((task) => task.id === selectedTaskId) : undefined
  const selectedOutOfScope = selectedTask !== undefined && !isTaskInScope(selectedTask, scope)
  const selectedHidden =
    selectedTask !== undefined && !selectedOutOfScope && !visibleTasks.some((task) => task.id === selectedTask.id)

  const handleSelect = async (taskId: string) => {
    if (taskId === selectedTaskId) return
    if (await confirmLeave()) selectTask(taskId)
  }

  const handleToggleCompleted = async (task: TaskDto) => {
    if (pendingTaskIds.has(task.id)) return
    const blocked = reopenBlockedReason(task, projectsQuery.data)
    if (blocked) {
      setBlockedNotice(blocked)
      setAnnouncement(blocked)
      return
    }
    setBlockedNotice(null)
    // 未保存の編集があるタスクは、完了操作の前に確認する（入力を黙って失わない）
    if (!(await confirmLeave({ target: { kind: 'task', id: task.id } }))) return
    setCompleted.mutate(
      { id: task.id, completed: task.completedAt === null },
      {
        onSuccess: (saved) =>
          setAnnouncement(`「${saved.title}」を${saved.completedAt === null ? '未完了に戻しました' : '完了にしました'}`)
      }
    )
  }

  // Inboxの行からの紐付け。最終的な所属先を1回で保存する（成功した後だけ一覧から消える）
  const handleAssign = (task: TaskDto, assignment: Assignment) => {
    if (pendingTaskIds.has(task.id)) return
    setAssignment.reset()
    setAssignment.mutate(
      { id: task.id, ...assignment },
      {
        onSuccess: (saved) => {
          const projectName = projectsQuery.data?.find((item) => item.id === saved.projectId)?.name ?? ''
          setAnnouncement(`「${saved.title}」を「${projectName}」に紐付けました`)
        }
      }
    )
  }

  // マイルストンの見出し（プロジェクト画面）。操作はlistboxの外の通常のボタン
  const renderGroupHeader = (group: TaskGroup) => (
    <>
      <Typography component="span" noWrap sx={{ fontSize: 12, fontWeight: 600, minWidth: 0 }} data-testid="group-label">
        {group.label}
      </Typography>
      <Typography component="span" sx={{ fontSize: 11, color: 'text.secondary', flexShrink: 0 }}>
        {group.tasks.length} 件
      </Typography>
      <Box sx={{ ml: 'auto', display: 'flex', gap: 1, flexShrink: 0 }}>
        <Button
          size="small"
          startIcon={<Plus size={12} aria-hidden />}
          disabled={projectCompleted}
          aria-label={`「${group.label}」にタスクを追加`}
          data-add-group={group.milestoneId ?? ''}
          onClick={() => {
            setAddMilestoneId(group.milestoneId)
            requestAnimationFrame(() => quickAddInputRef.current?.focus())
          }}
          sx={{ fontSize: 11, py: 0, minWidth: 0 }}
        >
          タスク追加
        </Button>
        {group.milestoneId !== null && onRenameMilestone && (
          <Button
            size="small"
            startIcon={<Pencil size={12} aria-hidden />}
            aria-label={`マイルストン「${group.label}」の名前を変更`}
            data-rename-milestone={group.milestoneId}
            onClick={() => onRenameMilestone(group.milestoneId as string)}
            sx={{ fontSize: 11, py: 0, minWidth: 0 }}
          >
            名前変更
          </Button>
        )}
      </Box>
    </>
  )

  const quickAddTarget = project
    ? `「${project.name}」${addMilestone ? ` › ${addMilestone.name}` : '（マイルストン未設定）'}に追加`
    : addTargetLabel

  return (
    <>
      {/* 一覧より上の領域は縮めない（一覧だけがスクロールする） */}
      <Box sx={{ flexShrink: 0 }}>
        <TaskQuickAdd
          projectId={scopeProjectId(scope)}
          milestoneId={addMilestone ? addMilestone.id : null}
          targetLabel={quickAddTarget}
          disabledReason={addDisabledReason}
          inputRef={quickAddInputRef}
        />

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
          <TextField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="タイトルで絞り込み"
            size="small"
            autoComplete="off"
            sx={{ flex: '1 1 200px', minWidth: 160 }}
            slotProps={{
              htmlInput: { 'aria-label': 'タイトルで絞り込み' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search size={14} aria-hidden />
                  </InputAdornment>
                )
              }
            }}
          />
          <ToggleButtonGroup
            value={status}
            exclusive
            size="small"
            aria-label="表示するタスク"
            onChange={(_event, value: TaskStatusFilter | null) => {
              if (value) setStatus(value)
            }}
          >
            {(Object.keys(STATUS_LABELS) as TaskStatusFilter[]).map((key) => (
              <ToggleButton key={key} value={key} sx={{ px: 3, py: 0.5, fontSize: 12 }}>
                {STATUS_LABELS[key]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary" role="status" data-testid="task-count">
            {visibleTasks.length} 件表示 / 全 {scopeCount} 件
          </Typography>
        </Box>
        <Typography id={TASK_LIST_HELP_ID} variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          一覧の操作: ↑↓ で移動、Enter で選択、Space で完了／未完了の切り替え{scope.kind === 'inbox' ? '、M で紐付け' : ''}
        </Typography>
        <Box
          role="status"
          aria-live="polite"
          data-testid="task-announcement"
          sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
        >
          {announcement}
        </Box>

        {setAssignment.isError && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setAssignment.reset()} data-testid="assign-error">
            紐付けできませんでした: {setAssignment.error.message}
          </Alert>
        )}
        {setCompleted.isError && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setCompleted.reset()}>
            完了状態を更新できませんでした: {setCompleted.error.message}
          </Alert>
        )}
        {blockedNotice && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2 }} onClose={() => setBlockedNotice(null)} data-testid="task-blocked-notice">
            {blockedNotice}
          </Alert>
        )}
        {selectedOutOfScope && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2, py: 0 }} data-testid="selected-out-of-scope">
            選択中のタスクは、この一覧（{scopeLabel}）の対象外です（所属を変更したため。詳細パネルには表示しています）。
          </Alert>
        )}
        {selectedHidden && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2, py: 0 }}>
            選択中のタスクは現在の条件では一覧に表示されていません（詳細パネルには表示しています）。
          </Alert>
        )}
      </Box>

      {tasksQuery.isPending ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }} role="status">
          <CircularProgress size={14} aria-hidden />
          <Typography variant="body2">読み込み中…</Typography>
        </Box>
      ) : tasksQuery.isError ? (
        <Alert severity="error" variant="outlined">
          タスクを読み込めませんでした: {tasksQuery.error.message}
        </Alert>
      ) : scopeCount === 0 && !groups ? (
        <Typography variant="body2" color="text.secondary" role="status">
          タスクはまだありません。
        </Typography>
      ) : (
        <>
          {visibleTasks.length === 0 && scopeCount > 0 && (
            <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1 }}>
              条件に一致するタスクはありません。
            </Typography>
          )}
          <TaskList
            tasks={visibleTasks}
            groups={groups}
            renderGroupHeader={renderGroupHeader}
            onRequestAssign={
              scope.kind === 'inbox' ? (task, anchor) => !pendingTaskIds.has(task.id) && setAssignTarget({ task, anchor }) : undefined
            }
            totalCount={scopeCount}
            selectedTaskId={selectedTaskId}
            pendingTaskIds={pendingTaskIds}
            sorting={sorting}
            resetScrollKey={`${scopeKey}\u0000${search}\u0000${status}\u0000${JSON.stringify(sorting)}\u0000${revealOpenRequest}`}
            onSort={(column) => onSortingChange((current) => nextSorting(current, column))}
            onSelect={(taskId) => void handleSelect(taskId)}
            onToggleCompleted={(task) => void handleToggleCompleted(task)}
          />
        </>
      )}
      {assignTarget && (
        <AssignMenu
          task={assignTarget.task}
          anchor={assignTarget.anchor}
          onChoose={(assignment) => handleAssign(assignTarget.task, assignment)}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </>
  )
}
