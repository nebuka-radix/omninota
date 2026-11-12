import { describe, expect, it, vi } from 'vitest'
import { getProjectPageState, resolveStartupTarget } from '../../src/renderer/src/features/projects/project-route'
import type { ProjectDto } from '../../src/shared/contracts/projects'

const ID = '6f1c2f8e-3c1d-4f0a-9b7e-2a6d1f3c9e10'
const OTHER_ID = '00000000-0000-4000-8000-000000000001'
const project: ProjectDto = {
  id: ID,
  name: '仕事',
  createdAt: '2026-11-09T00:00:00.000Z',
  done: false,
  updatedAt: '2026-11-09T00:00:00.000Z',
  doneOn: null
}

describe('起動時の画面の復元（ルート未指定の場合）', () => {
  it.each(['/inbox', '/settings', '/projects', '/summary'] as const)('%s はそのまま開き、プロジェクト一覧は取得しない', async (route) => {
    const load = vi.fn(async () => [project])
    expect(await resolveStartupTarget(route, load)).toEqual({ to: route })
    expect(load).not.toHaveBeenCalled()
  })

  it('保存済みのプロジェクトが存在すれば、そのプロジェクトを開く', async () => {
    expect(await resolveStartupTarget(`/projects/${ID}`, async () => [project])).toEqual({
      to: '/projects/$projectId',
      projectId: ID
    })
  })

  it('保存済みのプロジェクトが存在しなければ /projects を開く', async () => {
    expect(await resolveStartupTarget(`/projects/${OTHER_ID}`, async () => [project])).toEqual({ to: '/projects' })
    expect(await resolveStartupTarget(`/projects/${OTHER_ID}`, async () => [])).toEqual({ to: '/projects' })
  })

  it('一覧の取得に失敗したら「存在しない」とは判定せず、そのプロジェクトのルートを開く（画面で取得失敗を表示）', async () => {
    const load = async (): Promise<ProjectDto[]> => {
      throw new Error('DBエラー')
    }
    expect(await resolveStartupTarget(`/projects/${ID}`, load)).toEqual({ to: '/projects/$projectId', projectId: ID })
  })

  it.each([
    'https://example.com/',
    'javascript:alert(1)',
    '/projects/not-a-uuid',
    `/projects/${ID}/tasks`,
    '/projects/../settings',
    ''
  ])('想定外の値 %j は /inbox（プロジェクト一覧は取得しない）', async (route) => {
    const load = vi.fn(async () => [project])
    expect(await resolveStartupTarget(route, load)).toEqual({ to: '/inbox' })
    expect(load).not.toHaveBeenCalled()
  })
})

describe('/projects/$projectId の表示状態', () => {
  const ok = (data: ProjectDto[]) => ({ isPending: false, error: null, data })

  it('IDの形式が不正なら、取得結果によらず invalid-id', () => {
    expect(getProjectPageState('not-a-uuid', ok([project]))).toEqual({ kind: 'invalid-id' })
    expect(getProjectPageState(ID.toUpperCase(), ok([project]))).toEqual({ kind: 'invalid-id' })
  })

  it('取得中は loading', () => {
    expect(getProjectPageState(ID, { isPending: true, error: null, data: undefined })).toEqual({ kind: 'loading' })
  })

  it('取得失敗は error（not-found とは区別し、理由を表示に使う）', () => {
    expect(getProjectPageState(ID, { isPending: false, error: new Error('DBエラー'), data: undefined })).toEqual({
      kind: 'error',
      message: 'DBエラー'
    })
    // 再取得の失敗（以前のデータあり）も取得失敗として扱う
    expect(getProjectPageState(ID, { isPending: false, error: new Error('x'), data: [project] })).toEqual({
      kind: 'error',
      message: 'x'
    })
  })

  it('取得に成功して該当がなければ not-found、あれば found', () => {
    expect(getProjectPageState(OTHER_ID, ok([project]))).toEqual({ kind: 'not-found' })
    expect(getProjectPageState(ID, ok([]))).toEqual({ kind: 'not-found' })
    expect(getProjectPageState(ID, ok([project]))).toEqual({ kind: 'found', project })
  })
})
