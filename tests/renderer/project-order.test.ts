import { describe, expect, it } from 'vitest'
import { sortProjects } from '../../src/renderer/src/features/projects/project-order'
import type { ProjectDto } from '../../src/shared/contracts/projects'

const p = (id: string, name: string, createdAt: string, doneOn: string | null = null): ProjectDto => ({
  favorite: false,
  id,
  name,
  createdAt,
  updatedAt: createdAt,
  done: doneOn !== null,
  doneOn
})

describe('プロジェクト一覧の表示順', () => {
  it('未完了 → 完了、各区分は日本語の名前順（数字は数値として比較）', () => {
    const projects = [
      p('1', '仕事 10', '2026-01-01T00:00:00.000Z'),
      p('2', 'あ', '2026-01-02T00:00:00.000Z', '2026-02-01T00:00:00.000Z'),
      p('3', '仕事 9', '2026-01-03T00:00:00.000Z'),
      p('4', 'Alpha', '2026-01-04T00:00:00.000Z'),
      p('5', 'alpha', '2026-01-05T00:00:00.000Z')
    ]
    expect(sortProjects(projects).map((project) => project.id)).toEqual(['4', '5', '3', '1', '2'])
  })

  it('同名なら作成日時の古い順、同時刻ならIDの昇順（入力順によらず同じ順序）', () => {
    const a = p('b', '同名', '2026-01-01T00:00:00.000Z')
    const b = p('a', '同名', '2026-01-01T00:00:00.000Z')
    const c = p('c', '同名', '2025-12-31T00:00:00.000Z')
    expect(sortProjects([a, b, c]).map((project) => project.id)).toEqual(['c', 'a', 'b'])
    expect(sortProjects([c, b, a]).map((project) => project.id)).toEqual(['c', 'a', 'b'])
  })
})
