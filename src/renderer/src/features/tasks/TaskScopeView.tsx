import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, CircularProgress, InputAdornment, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useTable, type SortingState } from '@tanstack/react-table'
import { Search } from 'lucide-react'
import type { TaskDto } from '../../../../shared/contracts/tasks'
import { useDraftGuard } from '../drafts/DraftGuard'
import { useWorkspace } from '../workspace/WorkspaceContext'
import { TASK_LIST_HELP_ID, TaskList } from './TaskList'
import { TaskQuickAdd } from './TaskQuickAdd'
import { taskListQueryOptions, usePendingTaskIds, useSetTaskCompletedMutation } from './task-queries'
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
// - ソートは呼び出し側が持つ（プロジェクトを切り替えても維持する）。
// - 別の範囲を開いたら、タスクの選択を解除する（WorkspaceContext.enterTaskScope）。
export function TaskScopeView({
  scope,
  scopeLabel,
  addTargetLabel,
  addDisabledReason,
  sorting,
  onSortingChange
}: {
  scope: TaskScope
  // 一覧の説明（「プロジェクトに属さないタスク」など。対象外の表示に使う）
  scopeLabel: string
  addTargetLabel: string
  addDisabledReason?: string | undefined
  sorting: SortingState
  onSortingChange: (updater: SortingState | ((current: SortingState) => SortingState)) => void
}) {
  const tasksQuery = useQuery(taskListQueryOptions)
  const data = tasksQuery.data ?? EMPTY_TASKS
  const { selectedTaskId, selectTask, enterTaskScope } = useWorkspace()
  const { confirmLeave } = useDraftGuard()
  const pendingTaskIds = usePendingTaskIds()
  const setCompleted = useSetTaskCompletedMutation()
  const scopeKey = taskScopeKey(scope)
  // 呼び出し側が毎回新しいオブジェクトを渡しても、範囲が同じなら同じ値を使う（Tableの絞り込みを作り直さない）
  const stableScope = useMemo(() => scope, [scopeKey]) // scope は scopeKey と一対一

  useEffect(() => {
    enterTaskScope(scopeKey)
  }, [enterTaskScope, scopeKey])

  // 検索・表示切り替えは画面内の状態（保存しない）
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<TaskStatusFilter>(DEFAULT_TASK_STATUS)
  // 完了切り替えの結果を読み上げる（ライブリージョン）
  const [announcement, setAnnouncement] = useState('')

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

  return (
    <>
      {/* 一覧より上の領域は縮めない（一覧だけがスクロールする） */}
      <Box sx={{ flexShrink: 0 }}>
        <TaskQuickAdd projectId={scopeProjectId(scope)} targetLabel={addTargetLabel} disabledReason={addDisabledReason} />

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
          一覧の操作: ↑↓ で移動、Enter で選択、Space で完了／未完了の切り替え
        </Typography>
        <Box
          role="status"
          aria-live="polite"
          data-testid="task-announcement"
          sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}
        >
          {announcement}
        </Box>

        {setCompleted.isError && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setCompleted.reset()}>
            完了状態を更新できませんでした: {setCompleted.error.message}
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
      ) : scopeCount === 0 ? (
        <Typography variant="body2" color="text.secondary" role="status">
          タスクはまだありません。
        </Typography>
      ) : (
        <>
          {visibleTasks.length === 0 && (
            <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 1 }}>
              条件に一致するタスクはありません。
            </Typography>
          )}
          <TaskList
            tasks={visibleTasks}
            totalCount={scopeCount}
            selectedTaskId={selectedTaskId}
            pendingTaskIds={pendingTaskIds}
            sorting={sorting}
            resetScrollKey={`${scopeKey}\u0000${search}\u0000${status}\u0000${JSON.stringify(sorting)}`}
            onSort={(column) => onSortingChange((current) => nextSorting(current, column))}
            onSelect={(taskId) => void handleSelect(taskId)}
            onToggleCompleted={(task) => void handleToggleCompleted(task)}
          />
        </>
      )}
    </>
  )
}
