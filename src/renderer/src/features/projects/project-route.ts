// Projects画面のルートに関する判定。DOMやwindowに依存しない（ホストNode.jsのテストで検証する）。
import type { ProjectDto } from '../../../../shared/contracts/projects'
import { projectIdFromRoute, UUID_PATTERN, type WorkspaceRoute } from '../../../../shared/contracts/workspace'

export type StartupTarget =
  | { to: '/inbox' | '/settings' | '/projects' | '/summary' }
  | { to: '/projects/$projectId'; projectId: string }

// ルート未指定で起動した時の移動先を、保存済みの最後の画面から決める。
// - /projects/<UUID>: プロジェクト一覧で存在を確かめ、なければ /projects へ。
//   一覧の取得に失敗した場合は存在しないとは判定せず、そのまま開く（画面側で取得失敗として表示する）。
// - それ以外の既知の画面はそのまま。未知の値は /inbox。
export async function resolveStartupTarget(
  lastRoute: WorkspaceRoute | string,
  loadProjects: () => Promise<ProjectDto[]>
): Promise<StartupTarget> {
  const projectId = projectIdFromRoute(lastRoute)
  if (projectId) {
    let exists = true
    try {
      exists = (await loadProjects()).some((project) => project.id === projectId)
    } catch {
      exists = true
    }
    return exists ? { to: '/projects/$projectId', projectId } : { to: '/projects' }
  }
  if (lastRoute === '/inbox' || lastRoute === '/settings' || lastRoute === '/projects' || lastRoute === '/summary') return { to: lastRoute }
  return { to: '/inbox' }
}

// /projects/$projectId の表示状態。取得失敗（IPC・DBエラー）と「存在しない」を区別する。
export type ProjectPageState =
  | { kind: 'invalid-id' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'not-found' }
  | { kind: 'found'; project: ProjectDto }

export function getProjectPageState(
  projectId: string,
  query: { isPending: boolean; error: Error | null; data: ProjectDto[] | undefined }
): ProjectPageState {
  if (!UUID_PATTERN.test(projectId)) return { kind: 'invalid-id' }
  if (query.error) return { kind: 'error', message: query.error.message }
  if (query.isPending || !query.data) return { kind: 'loading' }
  const project = query.data.find((item) => item.id === projectId)
  return project ? { kind: 'found', project } : { kind: 'not-found' }
}
