import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  InputAdornment,
  MenuItem,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useTable, type SortingState } from '@tanstack/react-table'
import { Columns3, Link2, Rows3, Search, Trash2, X } from 'lucide-react'
import type { ProjectDto } from '../../../../shared/contracts/projects'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import type { MilestoneLayout } from '../../../../shared/contracts/workspace'
import { ShellSlot } from '../../components/ShellSlots'
import { vscodeColors } from '../../theme'
import { MilestoneBoard } from '../milestones/MilestoneBoard'
import { milestoneListQueryOptions } from '../milestones/milestone-queries'
import { useDraftGuard } from '../drafts/DraftGuard'
import { projectListQueryOptions } from '../projects/project-queries'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { AssignMenu } from './AssignMenu'
import { buildTaskGroups, milestonesOf, type Assignment } from './assignment'
import { EMPTY_SELECTION, operationTargets, pruneSelection, removeFromSelection, type TaskSelection } from './selection'
import { TaskList } from './TaskList'
import { useTaskDrag, type DropTarget } from './TaskDragContext'
import { TaskQuickAdd } from './TaskQuickAdd'
import { taskListQueryOptions, useAssignInboxTasksMutation, usePendingTaskIds } from './task-queries'
import { shouldClearSearchToRevealOpen } from './task-rules'
import { useTaskRowActions } from './use-task-row-actions'
import { isTaskInScope, scopeProjectId, taskScopeKey, type TaskScope } from './task-scope'
import {
  DEFAULT_PROJECT_SORTING,
  DEFAULT_TASK_STATUS,
  isManualSorting,
  nextSorting,
  PROJECT_SORT_OPTIONS,
  projectSortKeyOf,
  scopeAndStatusFilterState,
  taskColumns,
  taskTableFeatures,
  taskTableOptions,
  type ProjectSortKey,
  type TaskSortColumn,
  type TaskStatusFilter
} from './task-table'

const EMPTY_TASKS: TaskDto[] = []

const STATUS_LABELS: Record<TaskStatusFilter, string> = { open: '未完了', completed: '完了', all: 'すべて' }

// 並べ替え（カード内のタスクのドラッグ）を無効にする理由（フェーズ5.9。絞り込み中の表示行だけで順位を保存しない）
export const REORDER_FILTERED_REASON = '並べ替えるには、検索を空にして、状態を「すべて」にしてください。'

// 表示範囲（Inbox / プロジェクト）のタスク一覧と追加欄（フェーズ5.2でInboxから共通化）。
// Queryが全件を取得し、Tableが範囲・状態・検索で絞り込んでソートし、Virtualが表示範囲だけを描画する。
// （仮想化は描画量を減らすだけで、DBからの取得件数は減らない）
// - 検索・状態フィルターはこのコンポーネントの状態。範囲を切り替える時は key で作り直して初期化する。
//   状態の初期値は呼び出し側が決める（完了済みプロジェクトは「完了」。フェーズ5.3）。
// - revealOpenRequest が増えたら「未完了のタスクを表示」: 状態を未完了にし、検索で隠れる未完了タスクがあれば検索をクリアし、
//   先頭へスクロールする（範囲・選択・ドラフトは変えない。フェーズ5.3）。
// - ソートは呼び出し側が持つ（プロジェクトを切り替えても維持する）。
// - 別の範囲を開いたら、タスクの選択を解除する（WorkspaceContext.enterTaskScope）。
// フェーズ5.5:
// - プロジェクト: マイルストン別のカード（MilestoneBoard）。カードごとに別の仮想リスト。検索・状態・ソートは全カード共通。
// - Inbox: 従来どおりの追加欄と一覧（カード表示にはしない）。
// フェーズ5.8:
// - 検索・状態・並べ替え（プロジェクト）はトップバーに、件数はステータスバーの中央に描画する（ShellSlot。状態はここのまま）。
// フェーズ5.9:
// - Inbox: 複数選択（選択集合と基準行はここ。現在行は一覧）。表示対象から外れたIDは選択から外す。
//   一括紐付け（ドラッグ＆ドロップ・M キー・行のメニュー・選択バー）と一括削除（確認なし）は、表示中の選択タスクだけが対象。
//   紐付けは Main の一括API（1つのトランザクション）。保存中は対象の行を薄く表示し、重ねて操作できない。
//   成功したら対象を選択から外し、右の詳細に表示中なら選択を解除する（Inbox外のタスクを選択し続けない）。失敗時は行・選択を残し理由を表示する。
// - Inbox・カード: タスク名のインライン編集（ダブルクリック・F2・行のメニュー）。状態はここ（仮想化で行が消えても失わない）。
// - プロジェクト: 並べ替えに「手動順」「作成日時が古い順」などを用意（既定は手動順）。カードの並べ方（column / row）はトップバーで切り替え、保存する。
export function TaskScopeView({
  scope,
  scopeLabel,
  addDisabledReason,
  sorting,
  onSortingChange,
  initialStatus = DEFAULT_TASK_STATUS,
  revealOpenRequest = 0,
  project
}: {
  scope: TaskScope
  // 一覧の説明（「プロジェクトに属さないタスク」など。対象外の表示に使う）
  scopeLabel: string
  // 追加欄（Inboxだけ）の追加できない理由（フェーズ5.8で追加先の表示は廃止）
  addDisabledReason?: string | undefined
  sorting: SortingState
  onSortingChange: (updater: SortingState | ((current: SortingState) => SortingState)) => void
  initialStatus?: TaskStatusFilter
  revealOpenRequest?: number
  // プロジェクト画面の場合の対象プロジェクト（マイルストン別の表示・追加先の表示に使う）
  project?: ProjectDto | undefined
}) {
  const tasksQuery = useQuery(taskListQueryOptions)
  const data = tasksQuery.data ?? EMPTY_TASKS
  const { selectedTaskId, selectTask, enterTaskScope, setInboxPanel, inboxPanel, settings, setMilestoneLayout } = useWorkspace()
  const { confirmLeave, hasDirty } = useDraftGuard()
  const pendingTaskIds = usePendingTaskIds()
  const projectsQuery = useQuery(projectListQueryOptions)
  const milestonesQuery = useQuery(milestoneListQueryOptions)
  const assignTasks = useAssignInboxTasksMutation()
  const { startDrag } = useTaskDrag()
  const isInbox = scope.kind === 'inbox'
  // 紐付けメニューの対象（Inbox の一括紐付け: M キー・選択バー。複数可。行の紐付けアイコンは useTaskRowActions の1件の操作）
  const [assignTarget, setAssignTarget] = useState<{ tasks: TaskDto[]; anchor: HTMLElement } | null>(null)
  // Inboxの複数選択（フェーズ5.9）
  const [selection, setSelection] = useState<TaskSelection>(EMPTY_SELECTION)
  const [assignError, setAssignError] = useState<string | null>(null)
  const assigningRef = useRef(false)
  const scopeKey = taskScopeKey(scope)
  // 呼び出し側が毎回新しいオブジェクトを渡しても、範囲が同じなら同じ値を使う（Tableの絞り込みを作り直さない）
  const stableScope = useMemo(() => scope, [scopeKey]) // scope は scopeKey と一対一

  useEffect(() => {
    enterTaskScope(scopeKey)
  }, [enterTaskScope, scopeKey])

  // 検索・表示切り替えは画面内の状態（保存しない）
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<TaskStatusFilter>(initialStatus)
  // 操作の結果を読み上げる（ライブリージョン）
  const [announcement, setAnnouncement] = useState('')

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
  const rows = table.getRowModel().rows
  const visibleTasks = useMemo(() => rows.map((row) => row.original), [rows])
  const visibleIds = useMemo(() => visibleTasks.map((task) => task.id), [visibleTasks])
  const projectMilestones = useMemo(
    () => (project ? milestonesOf(milestonesQuery.data ?? [], project.id) : []),
    [project, milestonesQuery.data]
  )
  // マイルストン別のグループ＝カード（プロジェクト画面だけ）。Tableで絞り込み・ソートした順序のまま振り分ける
  const groups = project ? buildTaskGroups(visibleTasks, projectMilestones) : null
  const projectCompleted = project !== undefined && project.done
  const scopeCount = useMemo(() => data.filter((task) => isTaskInScope(task, stableScope)).length, [data, stableScope])

  // 表示対象から外れたID（絞り込み・削除・紐付けなど）は、見えないまま一括操作の対象に残さない
  useEffect(() => {
    if (!isInbox) return
    const visible = new Set(visibleIds)
    setSelection((current) => pruneSelection(current, visible))
  }, [isInbox, visibleIds])
  const selectedVisible = isInbox ? visibleIds.filter((id) => selection.ids.has(id)) : []

  const selectedTask = selectedTaskId ? data.find((task) => task.id === selectedTaskId) : undefined
  const selectedOutOfScope = selectedTask !== undefined && !isTaskInScope(selectedTask, scope)
  const selectedHidden =
    selectedTask !== undefined && !selectedOutOfScope && !visibleTasks.some((task) => task.id === selectedTask.id)

  // Inbox（フェーズ5.9）: 紐付け（ドラッグ・メニュー・M）で移したタスクは、成功時に選択を解除する（assignToMilestone）。
  // 詳細パネルで表示中のタスクの所属を変えた場合は、編集を続けられるよう詳細は表示したままにする（メイン側の「対象外です」の警告は出さない）。
  const handleSelect = async (taskId: string) => {
    if (taskId === selectedTaskId) return
    if (await confirmLeave()) selectTask(taskId)
  }

  // 明示的な詳細表示（Enter・行のメニュー）。Inboxでは右サイドバーをタスク詳細に切り替える
  const showDetail = async (taskId: string) => {
    if (taskId !== selectedTaskId && !(await confirmLeave())) return
    selectTask(taskId)
    if (isInbox) setInboxPanel('detail')
  }

  // 操作の対象（Inbox: 起点の行が選択に含まれていれば、表示中の選択タスクすべて。含まれなければその行だけ）
  const latest = useRef({ data, visibleIds, selection })
  latest.current = { data, visibleIds, selection }
  const targetsFor = (task: TaskDto): TaskDto[] => {
    if (!isInbox) return [task]
    const byId = new Map(latest.current.data.map((item) => [item.id, item]))
    return operationTargets(latest.current.selection, task.id, latest.current.visibleIds)
      .map((id) => byId.get(id))
      .filter((item): item is TaskDto => item !== undefined)
  }

  // Inboxからの一括紐付け（ドロップ・メニュー共通）。Main の一括API（1つのトランザクション）で全件を検証・更新する
  const assignToMilestone = async (tasks: readonly TaskDto[], assignment: Assignment, targetLabel: string) => {
    if (assigningRef.current || tasks.length === 0 || assignment.projectId === null || assignment.milestoneId === null) return
    if (tasks.some((task) => pendingTaskIds.has(task.id))) return
    assigningRef.current = true
    setAssignError(null)
    try {
      // 移すタスクに未保存のタイトル（詳細パネル・インライン編集）があれば、既存の確認を先に行う（黙って失わない）
      for (const task of tasks) {
        if (!(await confirmLeave({ target: { kind: 'task', id: task.id } }))) return
      }
      const ids = tasks.map((task) => task.id)
      await assignTasks.mutateAsync({ ids, projectId: assignment.projectId, milestoneId: assignment.milestoneId })
      const moved = new Set(ids)
      setSelection((current) => removeFromSelection(current, moved))
      // 右の詳細に表示中のタスクを移したら、選択を解除する（Inbox外のタスクを選択し続けない）
      if (selectedTaskId !== null && moved.has(selectedTaskId)) selectTask(null)
      setAnnouncement(
        ids.length === 1 ? `「${tasks[0]!.title}」を「${targetLabel}」に紐付けました` : `${ids.length} 件のタスクを「${targetLabel}」に紐付けました`
      )
    } catch (error) {
      setAssignError(`紐付けできませんでした: ${(error as Error).message}`)
    } finally {
      assigningRef.current = false
    }
  }

  const milestoneLabel = (assignment: Assignment) => {
    const projectName = projectsQuery.data?.find((item) => item.id === assignment.projectId)?.name ?? ''
    const milestoneName = milestonesQuery.data?.find((item) => item.id === assignment.milestoneId)?.name ?? ''
    return `${projectName} › ${milestoneName}`
  }

  // 行のドラッグ（Inbox → 右サイドバーの紐付け先）。選択中の行なら選択集合、未選択の行ならその行だけ
  const handleRowDragStart = (task: TaskDto, point: { x: number; y: number }) => {
    const tasks = targetsFor(task)
    if (tasks.length === 0 || assigningRef.current || tasks.some((item) => pendingTaskIds.has(item.id))) return
    // ドロップ先（紐付け先）を表示する。詳細に未保存の編集がある間は切り替えない（理由はドラッグ中の表示で示す）
    if (inboxPanel === 'detail' && !hasDirty(() => true)) setInboxPanel('targets')
    startDrag(
      {
        taskIds: tasks.map((item) => item.id),
        label: tasks[0]?.title ?? '',
        onDrop: (target: DropTarget) =>
          void assignToMilestone(tasks, { projectId: target.projectId, milestoneId: target.milestoneId }, target.label)
      },
      point
    )
  }

  // 行内の操作（TaskRow。3画面で共通）。ここには画面ごとの後処理だけを渡す
  const rowActions = useTaskRowActions({
    tasks: data,
    onAnnounce: setAnnouncement,
    onAssigned: (saved) => {
      // Inbox から紐付けた（Inbox外へ移した）タスク、またはプロジェクトの一覧から外れたタスクは、選択・詳細の選択から外す
      // （対象外の警告を出さない）
      setSelection((current) => removeFromSelection(current, new Set([saved.id])))
      if (!isTaskInScope(saved, stableScope)) rowActions.clearSelectionIf(saved.id)
    },
    onDeleted: (tasks) => {
      const removed = new Set(tasks.map((task) => task.id))
      setSelection((current) => removeFromSelection(current, removed))
    }
  })
  // Delete キー・選択バーの削除（確認なし。フェーズ5.9）。Inbox は選択中のタスクすべて（起点の行が選択に含まれていれば）
  const requestDelete = (task: TaskDto) => rowActions.deleteTasks(targetsFor(task))
  const requestAssign = (task: TaskDto, anchor: HTMLElement) => {
    const tasks = targetsFor(task)
    if (tasks.some((item) => pendingTaskIds.has(item.id))) return
    setAssignTarget({ tasks, anchor })
  }

  const resetScrollKey = `${scopeKey}\u0000${search}\u0000${status}\u0000${JSON.stringify(sorting)}\u0000${revealOpenRequest}`
  const handleSort = (column: TaskSortColumn) => onSortingChange((current) => nextSorting(current, column))

  // ステータスバーの件数（フェーズ5.8）: 絞り込み後の表示対象タスク数 / この範囲の全タスク数。
  const shownCount = groups ? groups.reduce((sum, group) => sum + group.tasks.length, 0) : visibleTasks.length
  const filtered = search.trim() !== '' || status !== 'all'
  const layout = settings.milestoneLayout
  const firstSelected = selectedVisible[0] ? data.find((task) => task.id === selectedVisible[0]) : undefined

  return (
    <>
      {/* 表示設定はトップバーへ（フェーズ5.8）。状態はこの部品のまま（範囲を切り替えると従来どおり初期化される） */}
      <ShellSlot name="top-bar-controls">
        <Box
          role="group"
          aria-label="表示設定"
          data-testid="view-controls"
          sx={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flex: 1 }}
        >
          <TextField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="タイトルで絞り込み"
            size="small"
            autoComplete="off"
            data-testid="view-search"
            sx={{
              flex: '0 1 240px',
              minWidth: 96,
              '& .MuiInputBase-root': { height: 28, fontSize: 12 }
            }}
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
            data-testid="view-status"
            sx={{ flexShrink: 0, height: 28 }}
            onChange={(_event, value: TaskStatusFilter | null) => {
              if (value) setStatus(value)
            }}
          >
            {(Object.keys(STATUS_LABELS) as TaskStatusFilter[]).map((key) => (
              <ToggleButton key={key} value={key} sx={{ px: 2.5, py: 0, fontSize: 12 }}>
                {STATUS_LABELS[key]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          {project && (
            // カード表示には列見出しがないため、並べ替えはここで行う（全カード共通）。Inboxは一覧の列見出しで並べ替える。
            // フェーズ5.9: 「手動順」（既定）と「作成日時が古い順」などを区別して選ぶ
            <Box sx={{ display: 'flex', alignItems: 'center', height: 28, flexShrink: 0, gap: 1 }} role="group" aria-label="並べ替え" data-testid="view-sort">
              {/* 狭い幅（ウィンドウ最小幅など）では見出しを隠し、操作が重ならないようにする（読み上げ名は選択欄に付けている） */}
              <Typography component="span" variant="caption" color="text.secondary" sx={{ display: { xs: 'none', lg: 'inline' } }}>
                並べ替え:
              </Typography>
              <TextField
                select
                size="small"
                value={projectSortKeyOf(sorting)}
                onChange={(event) => onSortingChange(PROJECT_SORT_OPTIONS[event.target.value as ProjectSortKey].sorting)}
                data-testid="view-sort-select"
                slotProps={{ select: { inputProps: { 'aria-label': '並べ替え' } } }}
                sx={{ width: { xs: 124, lg: 150 }, '& .MuiInputBase-root': { height: 28, fontSize: 12 } }}
              >
                {(Object.keys(PROJECT_SORT_OPTIONS) as ProjectSortKey[]).map((key) => (
                  <MenuItem key={key} value={key} sx={{ fontSize: 12 }} data-sort-key={key}>
                    {PROJECT_SORT_OPTIONS[key].label}
                  </MenuItem>
                ))}
              </TextField>
            </Box>
          )}
          {project && (
            // カードの並べ方（全プロジェクト共通・保存する。フェーズ5.9）
            <Box sx={{ display: 'flex', alignItems: 'center', height: 28, flexShrink: 0, gap: 1 }}>
              <Typography component="span" variant="caption" color="text.secondary" id="view-layout-label" sx={{ display: { xs: 'none', lg: 'inline' } }}>
                レイアウト:
              </Typography>
              <ToggleButtonGroup
                value={layout}
                exclusive
                size="small"
                aria-label="レイアウト"
                data-testid="view-layout"
                sx={{ height: 28 }}
                onChange={(_event, value: MilestoneLayout | null) => {
                  if (value) setMilestoneLayout(value)
                }}
              >
                <ToggleButton value="column" aria-label="column（カードを横に並べる）" title="column（カードを横に並べる）" sx={{ px: 1.5, py: 0, fontSize: 12, gap: 0.5 }}>
                  <Columns3 size={13} aria-hidden />
                  <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>
                    column
                  </Box>
                </ToggleButton>
                <ToggleButton value="row" aria-label="row（カードを縦に並べる）" title="row（カードを縦に並べる）" sx={{ px: 1.5, py: 0, fontSize: 12, gap: 0.5 }}>
                  <Rows3 size={13} aria-hidden />
                  <Box component="span" sx={{ display: { xs: 'none', lg: 'inline' } }}>
                    row
                  </Box>
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}
        </Box>
      </ShellSlot>
      {tasksQuery.isSuccess && (
        <ShellSlot name="status-count">
          <Typography component="span" role="status" data-testid="task-count" sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {shownCount} 件表示 / 全 {scopeCount} 件
          </Typography>
        </ShellSlot>
      )}
      {/* 一覧より上の領域は縮めない（一覧だけがスクロールする） */}
      <Box sx={{ flexShrink: 0 }}>
        {!project && <TaskQuickAdd projectId={scopeProjectId(scope)} disabledReason={addDisabledReason} />}

        <Box
          role="status"
          aria-live="polite"
          data-testid="task-announcement"
          sx={{ position: 'absolute', top: 0, left: 0, width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
        >
          {announcement}
        </Box>

        {assignError && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setAssignError(null)} data-testid="assign-error">
            {assignError}
          </Alert>
        )}
        {rowActions.alerts}
        {selectedOutOfScope && !isInbox && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2, py: 0 }} data-testid="selected-out-of-scope">
            選択中のタスクは、この一覧（{scopeLabel}）の対象外です（所属を変更したため。詳細パネルには表示しています）。
          </Alert>
        )}
        {projectCompleted && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2, py: 0 }} data-testid="project-completed-notice">
            完了済みのプロジェクトには、マイルストン・タスクを追加できません（右の詳細パネルで未完了に戻せます）。
          </Alert>
        )}
        {selectedHidden && (
          <Alert severity="info" variant="outlined" sx={{ mb: 2, py: 0 }}>
            選択中のタスクは現在の条件では一覧に表示されていません（詳細パネルには表示しています）。
          </Alert>
        )}
        {isInbox && selectedVisible.length >= 2 && firstSelected && (
          // 複数選択中の件数と一括操作（フェーズ5.9）
          <Box
            role="region"
            aria-label="選択中のタスク"
            data-testid="selection-bar"
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              mb: 1,
              px: 1.5,
              height: 30,
              borderRadius: 1,
              bgcolor: vscodeColors.sideBarBackground,
              border: `1px solid ${vscodeColors.border}`
            }}
          >
            <Typography component="span" role="status" sx={{ fontSize: 12, fontWeight: 600 }} data-testid="selection-count">
              {selectedVisible.length} 件選択中
            </Typography>
            <Button
              size="small"
              startIcon={<Link2 size={13} aria-hidden />}
              onClick={(event) => requestAssign(firstSelected, event.currentTarget)}
              disabled={selectedVisible.some((id) => pendingTaskIds.has(id))}
              data-testid="selection-assign"
              sx={{ fontSize: 12, py: 0 }}
            >
              紐付け…
            </Button>
            <Button
              size="small"
              color="error"
              startIcon={<Trash2 size={13} aria-hidden />}
              onClick={() => requestDelete(firstSelected)}
              disabled={selectedVisible.some((id) => pendingTaskIds.has(id))}
              data-testid="selection-delete"
              sx={{ fontSize: 12, py: 0 }}
            >
              {selectedVisible.length} 件を削除
            </Button>
            <Button
              size="small"
              startIcon={<X size={13} aria-hidden />}
              onClick={() => setSelection(EMPTY_SELECTION)}
              data-testid="selection-clear"
              sx={{ fontSize: 12, py: 0, ml: 'auto' }}
            >
              選択解除
            </Button>
          </Box>
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
          {project && groups ? (
            <MilestoneBoard
              project={project}
              groups={groups}
              layout={layout}
              selectedTaskId={selectedTaskId}
              pendingTaskIds={pendingTaskIds}
              sorting={sorting}
              resetScrollKey={resetScrollKey}
              onSort={handleSort}
              onSelect={(taskId) => void handleSelect(taskId)}
              actions={rowActions.actions}
              onRequestDelete={requestDelete}
              onAnnounce={setAnnouncement}
              taskReorder={{
                disabledReason: filtered ? REORDER_FILTERED_REASON : null,
                manual: isManualSorting(sorting),
                onSwitchToManual: () => onSortingChange(DEFAULT_PROJECT_SORTING)
              }}
            />
          ) : (
            <TaskList
              tasks={visibleTasks}
              actions={rowActions.actions}
              onRequestAssignKey={isInbox ? requestAssign : undefined}
              onRequestDelete={requestDelete}
              totalCount={scopeCount}
              selectedTaskId={selectedTaskId}
              pendingTaskIds={pendingTaskIds}
              sorting={sorting}
              resetScrollKey={resetScrollKey}
              onSort={handleSort}
              onSelect={(taskId) => void handleSelect(taskId)}
              multiSelect={
                isInbox
                  ? { selection, onChange: setSelection, onShowDetail: (taskId) => void showDetail(taskId) }
                  : undefined
              }
              onRowDragStart={isInbox ? handleRowDragStart : undefined}
            />
          )}
        </>
      )}
      {rowActions.elements}
      {assignTarget && (
        <AssignMenu
          tasks={assignTarget.tasks}
          anchor={assignTarget.anchor}
          onChoose={(assignment) => void assignToMilestone(assignTarget.tasks, assignment, milestoneLabel(assignment))}
          onClose={() => setAssignTarget(null)}
        />
      )}
    </>
  )
}
