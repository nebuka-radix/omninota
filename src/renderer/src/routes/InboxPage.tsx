import { useMemo, useState } from 'react'
import { Alert, Box, CircularProgress, InputAdornment, TextField, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import { useTable, type SortingState } from '@tanstack/react-table'
import { Inbox, Search } from 'lucide-react'
import type { TaskDto } from '../../../shared/contracts/tasks'
import { Page } from '../components/Page'
import { useDraftGuard } from '../features/tasks/DraftGuard'
import { TaskList } from '../features/tasks/TaskList'
import { TaskQuickAdd } from '../features/tasks/TaskQuickAdd'
import { taskListQueryOptions, usePendingTaskIds, useSetTaskCompletedMutation } from '../features/tasks/task-queries'
import {
  DEFAULT_TASK_SORTING,
  DEFAULT_TASK_STATUS,
  nextSorting,
  statusFilterState,
  taskColumns,
  taskTableFeatures,
  taskTableOptions,
  type TaskStatusFilter
} from '../features/tasks/task-table'
import { useWorkspace } from '../features/workspace/WorkspaceContext'

const EMPTY_TASKS: TaskDto[] = []

const STATUS_LABELS: Record<TaskStatusFilter, string> = { open: '未完了', completed: '完了', all: 'すべて' }

// Inbox: まだGTD分類を導入していないタスク一覧。
// Queryが全件を取得し、Tableが絞り込み・ソートを行い、Virtualが表示範囲だけを描画する。
// （仮想化は描画量を減らすだけで、DBからの取得件数は減らない）
export function InboxPage() {
  const tasksQuery = useQuery(taskListQueryOptions)
  const data = tasksQuery.data ?? EMPTY_TASKS
  const { selectedTaskId, selectTask } = useWorkspace()
  const { confirmLeave } = useDraftGuard()
  const pendingTaskIds = usePendingTaskIds()
  const setCompleted = useSetTaskCompletedMutation()

  // 検索・表示切り替え・ソートは画面内の状態（保存しない）
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<TaskStatusFilter>(DEFAULT_TASK_STATUS)
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_TASK_SORTING)

  // Tableへ渡す状態は値が変わった時だけ作り直す（毎回新しい配列だと行モデルが作り直される）
  const columnFilters = useMemo(() => statusFilterState(status), [status])

  const table = useTable({
    features: taskTableFeatures,
    columns: taskColumns,
    data,
    ...taskTableOptions,
    state: { sorting, globalFilter: search, columnFilters },
    onSortingChange: setSorting
  })
  const visibleTasks = table.getRowModel().rows.map((row) => row.original)

  const selectedTask = selectedTaskId ? data.find((task) => task.id === selectedTaskId) : undefined
  const selectedHidden = selectedTask !== undefined && !visibleTasks.some((task) => task.id === selectedTask.id)

  const handleSelect = async (taskId: string) => {
    if (taskId === selectedTaskId) return
    if (await confirmLeave()) selectTask(taskId)
  }

  const handleToggleCompleted = async (task: TaskDto) => {
    if (pendingTaskIds.has(task.id)) return
    // 未保存の編集があるタスクは、完了操作の前に確認する（入力を黙って失わない）
    if (!(await confirmLeave({ taskId: task.id }))) return
    setCompleted.mutate({ id: task.id, completed: task.completedAt === null })
  }

  return (
    <Page title="Inbox" icon={Inbox} fill>
      {/* 一覧より上の領域は縮めない（一覧だけがスクロールする） */}
      <Box sx={{ flexShrink: 0 }}>
        <TaskQuickAdd />

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
            {visibleTasks.length} 件表示 / 全 {data.length} 件
          </Typography>
        </Box>

        {setCompleted.isError && (
          <Alert severity="error" variant="outlined" sx={{ mb: 2 }} onClose={() => setCompleted.reset()}>
            完了状態を更新できませんでした: {setCompleted.error.message}
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
      ) : data.length === 0 ? (
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
            totalCount={data.length}
            selectedTaskId={selectedTaskId}
            pendingTaskIds={pendingTaskIds}
            sorting={sorting}
            resetScrollKey={`${search}\u0000${status}\u0000${JSON.stringify(sorting)}`}
            onSort={(column) => setSorting((current) => nextSorting(current, column))}
            onSelect={(taskId) => void handleSelect(taskId)}
            onToggleCompleted={(task) => void handleToggleCompleted(task)}
          />
        </>
      )}
    </Page>
  )
}
