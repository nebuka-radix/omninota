// Inbox一覧のTanStack Table（v9）設定。表示対象（絞り込み）と順序（ソート）はTableが決める。
// features・columnsはモジュールに置いて安定させる（毎回作り直すと行モデルが作り直されるため）。
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  tableFeatures,
  type ColumnFiltersState,
  type SortingState
} from '@tanstack/react-table'
import type { TaskDto } from '../../../../shared/contracts/tasks'

export const taskTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  // 大文字・小文字を区別しない部分一致（双方を小文字にして比較する）
  filterFns: { includesString: filterFn_includesString },
  rowSortingFeature,
  sortedRowModel: createSortedRowModel()
})

export type TaskStatusFilter = 'open' | 'completed' | 'all'
export type TaskSortColumn = 'title' | 'createdAt'

export const TASK_COLUMN_IDS = { title: 'title', createdAt: 'createdAt', status: 'status' } as const

const helper = createColumnHelper<typeof taskTableFeatures, TaskDto>()

const titleCollator = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' })

export const taskColumns = helper.columns([
  helper.accessor('title', {
    id: TASK_COLUMN_IDS.title,
    header: 'タイトル',
    sortFn: (rowA, rowB) => titleCollator.compare(rowA.original.title, rowB.original.title)
  }),
  helper.accessor('createdAt', {
    id: TASK_COLUMN_IDS.createdAt,
    header: '作成日時',
    // 作成日時が同じ場合はIDで比較し、常に同じ順序にする（DBの並び順と同じ規則）
    sortFn: (rowA, rowB) => {
      const a = rowA.original
      const b = rowB.original
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    }
  }),
  // 表示しない列。未完了／完了／すべての切り替えに使う（完了状態はcompletedAtから導出）
  helper.accessor((task) => (task.completedAt === null ? 'open' : 'completed'), {
    id: TASK_COLUMN_IDS.status,
    enableSorting: false,
    enableGlobalFilter: false,
    filterFn: (row, columnId, filterValue: TaskStatusFilter) =>
      filterValue === 'all' || row.getValue(columnId) === filterValue
  })
])

export const DEFAULT_TASK_SORTING: SortingState = [{ id: TASK_COLUMN_IDS.createdAt, desc: true }]
export const DEFAULT_TASK_STATUS: TaskStatusFilter = 'open'

export function statusFilterState(status: TaskStatusFilter): ColumnFiltersState {
  return [{ id: TASK_COLUMN_IDS.status, value: status }]
}

// 列見出しのクリックでのソート切り替え。同じ列なら昇順・降順を入れ替え、別の列なら既定の向きで始める。
export function nextSorting(current: SortingState, column: TaskSortColumn): SortingState {
  const active = current[0]
  if (active?.id === column) return [{ id: column, desc: !active.desc }]
  return [{ id: column, desc: column === 'createdAt' }]
}

export const taskTableOptions = {
  globalFilterFn: 'includesString',
  getColumnCanGlobalFilter: (column: { id: string }) => column.id === TASK_COLUMN_IDS.title,
  enableMultiSort: false,
  enableSortingRemoval: false,
  getRowId: (task: TaskDto) => task.id
} as const
