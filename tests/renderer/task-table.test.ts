import { constructTable, tableFeatures, type ColumnFiltersState, type SortingState } from '@tanstack/react-table'
import { storeReactivityBindings } from '@tanstack/table-core/store-reactivity-bindings'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_SORTING,
  nextSorting,
  statusFilterState,
  taskColumns,
  taskTableFeatures,
  taskTableOptions,
  type TaskStatusFilter
} from '../../src/renderer/src/features/tasks/task-table'
import type { TaskDto } from '../../src/shared/contracts/tasks'

const task = (id: string, title: string, createdAt: string, completedAt: string | null = null): TaskDto => ({
  id,
  title,
  createdAt,
  updatedAt: createdAt,
  projectId: null,
  completedAt
})

const data: TaskDto[] = [
  task('b', '牛乳を買う', '2026-11-09T00:00:00.000Z'),
  task('a', 'Report 提出', '2026-11-09T00:00:00.000Z', '2026-11-09T01:00:00.000Z'),
  task('c', 'report の見直し', '2026-11-09T00:00:01.000Z'),
  task('d', '会議 10', '2026-11-08T00:00:00.000Z'),
  task('e', '会議 9', '2026-11-07T00:00:00.000Z', '2026-11-08T00:00:00.000Z')
]

// Reactを使わずにTableの行モデルだけを確認する（ReactのuseTableが内部で行うリアクティブ設定を、ストア版で代用する）
const headlessFeatures = tableFeatures({ ...taskTableFeatures, coreReactivityFeature: storeReactivityBindings() })

function visibleIds(options: { sorting?: SortingState; search?: string; status?: TaskStatusFilter }): string[] {
  const columnFilters: ColumnFiltersState = statusFilterState(options.status ?? 'all')
  const table = constructTable({
    features: headlessFeatures,
    columns: taskColumns,
    data,
    ...taskTableOptions,
    state: {
      sorting: options.sorting ?? DEFAULT_TASK_SORTING,
      globalFilter: options.search ?? '',
      columnFilters
    }
  })
  return table.getRowModel().rows.map((row) => row.id)
}

describe('Inbox一覧のTable設定', () => {
  it('初期ソートは作成日時の降順で、同じ日時はIDの降順（DBと同じ規則）', () => {
    expect(visibleIds({})).toEqual(['c', 'b', 'a', 'd', 'e'])
  })

  it('作成日時の昇順は降順の完全な逆順', () => {
    expect(visibleIds({ sorting: [{ id: 'createdAt', desc: false }] })).toEqual(['e', 'd', 'a', 'b', 'c'])
  })

  it('タイトルのソートは数字を数値として比較する', () => {
    const ids = visibleIds({ sorting: [{ id: 'title', desc: false }], search: '会議' })
    expect(ids).toEqual(['e', 'd']) // 会議 9 → 会議 10
  })

  it('検索はタイトルの大文字・小文字を区別しない部分一致', () => {
    expect(visibleIds({ search: 'REPORT' })).toEqual(['c', 'a'])
    expect(visibleIds({ search: '牛乳' })).toEqual(['b'])
    expect(visibleIds({ search: '該当なし' })).toEqual([])
  })

  it('未完了／完了／すべての切り替え', () => {
    expect(visibleIds({ status: 'open' })).toEqual(['c', 'b', 'd'])
    expect(visibleIds({ status: 'completed' })).toEqual(['a', 'e'])
    expect(visibleIds({ status: 'all' })).toHaveLength(5)
  })

  it('検索と表示切り替えを組み合わせる', () => {
    expect(visibleIds({ search: 'report', status: 'open' })).toEqual(['c'])
  })

  it('行IDはタスクID（表示位置ではない）', () => {
    expect(visibleIds({ sorting: [{ id: 'title', desc: true }] }).sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('列見出しのソート切り替え', () => {
    expect(nextSorting(DEFAULT_TASK_SORTING, 'createdAt')).toEqual([{ id: 'createdAt', desc: false }])
    expect(nextSorting(DEFAULT_TASK_SORTING, 'title')).toEqual([{ id: 'title', desc: false }])
    expect(nextSorting([{ id: 'title', desc: false }], 'title')).toEqual([{ id: 'title', desc: true }])
  })
})
