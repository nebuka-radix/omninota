// タスク一覧（Inbox・プロジェクト）のTanStack Table（v9）設定。表示対象（絞り込み）と順序（ソート）はTableが決める。
// 表示範囲（所属）・状態・検索をすべてTableの絞り込みとして組み合わせる。データは全件Queryのまま（フェーズ5.2）。
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
import { compareManualOrder } from './assignment'
import { isTaskInScope, type TaskScope } from './task-scope'

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

export const TASK_COLUMN_IDS = { title: 'title', createdAt: 'createdAt', status: 'status', scope: 'scope', manual: 'manual' } as const

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
  // 表示しない列。プロジェクトのカード内の手動順（フェーズ5.9）。手動順 → 作成日時の古い順 → ID の昇順。
  // 手動順のないマイルストンは作成日時の古い順になる（初期順）。カードへの振り分けは並べた後に行う
  helper.accessor((task) => task.position, {
    id: TASK_COLUMN_IDS.manual,
    enableGlobalFilter: false,
    sortFn: (rowA, rowB) => compareManualOrder(rowA.original, rowB.original)
  }),
  // 表示しない列。未完了／完了／すべての切り替えに使う（完了状態はdoneOnから導出）
  helper.accessor((task) => (task.doneOn === null ? 'open' : 'completed'), {
    id: TASK_COLUMN_IDS.status,
    enableSorting: false,
    enableGlobalFilter: false,
    filterFn: (row, columnId, filterValue: TaskStatusFilter) =>
      filterValue === 'all' || row.getValue(columnId) === filterValue
  }),
  // 表示しない列。表示範囲（Inbox = 未所属 / プロジェクト）の絞り込みに使う（フェーズ5.2）
  helper.accessor((task) => task.projectId, {
    id: TASK_COLUMN_IDS.scope,
    enableSorting: false,
    enableGlobalFilter: false,
    filterFn: (row, _columnId, scope: TaskScope) => isTaskInScope(row.original, scope)
  })
])

export const DEFAULT_TASK_SORTING: SortingState = [{ id: TASK_COLUMN_IDS.createdAt, desc: true }]

// プロジェクト画面（カード）の並べ替え（フェーズ5.9）。既定は手動順（手動順がなければ作成日時の古い順）
export const PROJECT_SORT_OPTIONS = {
  manual: { label: '手動順', sorting: [{ id: TASK_COLUMN_IDS.manual, desc: false }] },
  'created-asc': { label: '作成日時が古い順', sorting: [{ id: TASK_COLUMN_IDS.createdAt, desc: false }] },
  'created-desc': { label: '作成日時が新しい順', sorting: [{ id: TASK_COLUMN_IDS.createdAt, desc: true }] },
  title: { label: 'タイトル順', sorting: [{ id: TASK_COLUMN_IDS.title, desc: false }] }
} as const satisfies Record<string, { label: string; sorting: SortingState }>
export type ProjectSortKey = keyof typeof PROJECT_SORT_OPTIONS
export const DEFAULT_PROJECT_SORTING: SortingState = PROJECT_SORT_OPTIONS.manual.sorting

export function projectSortKeyOf(sorting: SortingState): ProjectSortKey {
  const active = sorting[0]
  if (active?.id === TASK_COLUMN_IDS.manual) return 'manual'
  if (active?.id === TASK_COLUMN_IDS.title) return 'title'
  if (active?.id === TASK_COLUMN_IDS.createdAt) return active.desc ? 'created-desc' : 'created-asc'
  return 'manual'
}

export function isManualSorting(sorting: SortingState): boolean {
  return sorting[0]?.id === TASK_COLUMN_IDS.manual
}
export const DEFAULT_TASK_STATUS: TaskStatusFilter = 'open'

export function statusFilterState(status: TaskStatusFilter): ColumnFiltersState {
  return [{ id: TASK_COLUMN_IDS.status, value: status }]
}

// 表示範囲と状態の絞り込み（検索はglobalFilterで別に指定する）
export function scopeAndStatusFilterState(scope: TaskScope, status: TaskStatusFilter): ColumnFiltersState {
  return [{ id: TASK_COLUMN_IDS.scope, value: scope }, ...statusFilterState(status)]
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
